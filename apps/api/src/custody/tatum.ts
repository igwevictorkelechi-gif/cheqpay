import { createHmac, timingSafeEqual } from "node:crypto";
import { Asset, Network } from "@cheqpay/db";
import type { CustodyProvider, DepositAddress, IncomingDeposit } from "./types";

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
    };
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
