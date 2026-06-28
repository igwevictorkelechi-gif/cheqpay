import { createHmac, timingSafeEqual } from "node:crypto";
import { Asset, Network } from "@cheqpay/db";
import type {
  CustodyProvider,
  DepositAddress,
  IncomingDeposit,
  WithdrawalEvent,
  WithdrawalResult,
} from "./types";

const TATUM_BASE = "https://api.tatum.io/v3";

// Map our asset/network to Tatum's chain/currency identifiers.
const CHAIN: Partial<Record<Network, string>> = {
  [Network.BITCOIN]: "BTC",
  [Network.TRON]: "TRON",
  [Network.BSC]: "BSC",
  [Network.ETHEREUM]: "ETH",
};

/**
 * Tatum custody adapter (virtual-account / ledger model). Keys live in Tatum's
 * HSM; we store only the virtual-account id + public address.
 *
 * NOTE: This adapter is provider-correct in shape but has NOT been exercised
 * against the live Tatum API in this build (we ship the mock by default).
 * Validate the exact endpoints/payloads + webhook signing scheme against
 * current Tatum docs before enabling in production.
 */
export class TatumCustodyProvider implements CustodyProvider {
  readonly name = "tatum";

  constructor(
    private readonly apiKey: string,
    private readonly webhookSecret: string
  ) {}

  private async call<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${TATUM_BASE}${path}`, {
      ...init,
      headers: {
        "x-api-key": this.apiKey,
        "content-type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Tatum ${path} failed: ${res.status} ${text}`);
    }
    return (await res.json()) as T;
  }

  async createDepositAddress(input: {
    userId: string;
    asset: Asset;
    network: Network;
  }): Promise<DepositAddress> {
    const currency = CHAIN[input.network];
    if (!currency) {
      throw new Error(`Unsupported network for Tatum: ${input.network}`);
    }
    // 1) Create a virtual account (ledger) for the asset.
    const account = await this.call<{ id: string }>("/ledger/account", {
      method: "POST",
      body: JSON.stringify({
        currency: input.asset,
        // External id ties the VA back to our user for reconciliation.
        externalId: `${input.userId}:${input.asset}:${input.network}`,
      }),
    });
    // 2) Generate a deposit address on that account.
    const address = await this.call<{ address: string }>(
      `/offchain/account/${account.id}/address`,
      { method: "POST" }
    );
    return { address: address.address, custodyRef: account.id };
  }

  verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
    if (!signature) return false;
    // Tatum signs with HMAC-SHA512 over the raw body (header: x-payload-hash).
    const expected = createHmac("sha512", this.webhookSecret)
      .update(rawBody)
      .digest("base64");
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  parseDepositEvent(payload: unknown): IncomingDeposit | null {
    if (!payload || typeof payload !== "object") return null;
    const p = payload as Record<string, unknown>;
    const address = p.address ?? p.to;
    const amount = p.amount;
    const txHash = p.txId ?? p.txHash;
    const currency = p.currency ?? p.asset;
    const chain = p.chain;
    if (
      typeof address !== "string" ||
      typeof amount !== "string" ||
      typeof txHash !== "string" ||
      typeof currency !== "string"
    ) {
      return null;
    }
    const network = chainToNetwork(typeof chain === "string" ? chain : "");
    if (!network || !(currency in Asset)) return null;
    return {
      // Tatum subscriptions include a unique id; fall back to txHash+address.
      eventId: typeof p.subscriptionId === "string" ? `${p.subscriptionId}:${txHash}` : `${txHash}:${address}`,
      address,
      amount,
      txHash,
      asset: currency as Asset,
      network,
      confirmations:
        typeof p.confirmations === "number"
          ? p.confirmations
          : typeof p.confirmations === "string"
            ? Number(p.confirmations)
            : undefined,
    };
  }

  parseWithdrawalEvent(payload: unknown): WithdrawalEvent | null {
    if (!payload || typeof payload !== "object") return null;
    const p = payload as Record<string, unknown>;
    // Tatum withdrawal/outgoing notifications carry a txId + a status/type.
    const type = typeof p.type === "string" ? p.type.toLowerCase() : "";
    if (!type.includes("withdrawal") && p.subscriptionType !== "OUTGOING_PAYMENT") {
      return null;
    }
    const txHash = p.txId ?? p.txHash;
    if (typeof txHash !== "string") return null;
    const ok = p.status === "COMPLETED" || p.completed === true;
    const failed = p.status === "FAILED" || p.failed === true;
    if (!ok && !failed) return null;
    return {
      eventId: `withdrawal:${txHash}`,
      txHash,
      status: ok ? "completed" : "failed",
    };
  }

  async createWithdrawal(input: {
    userId: string;
    asset: Asset;
    network: Network;
    toAddress: string;
    amount: string;
  }): Promise<WithdrawalResult> {
    const currency = CHAIN[input.network];
    if (!currency) throw new Error(`Unsupported network for Tatum: ${input.network}`);
    // Tatum withdrawal off a virtual account (provider signs + broadcasts).
    const res = await this.call<{ txId?: string; id?: string }>("/offchain/withdrawal", {
      method: "POST",
      body: JSON.stringify({
        senderAccountId: `${input.userId}:${input.asset}:${input.network}`,
        address: input.toAddress,
        amount: input.amount,
      }),
    });
    return { txHash: res.txId ?? res.id ?? "", status: "broadcasting" };
  }
}

function chainToNetwork(chain: string): Network | null {
  switch (chain.toUpperCase()) {
    case "BTC":
    case "BITCOIN":
      return Network.BITCOIN;
    case "TRON":
    case "TRX":
      return Network.TRON;
    case "BSC":
      return Network.BSC;
    case "ETH":
    case "ETHEREUM":
      return Network.ETHEREUM;
    default:
      return null;
  }
}
