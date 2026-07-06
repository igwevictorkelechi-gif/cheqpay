import { createHmac, timingSafeEqual } from "node:crypto";
import { Asset, Network } from "@cheqpay/db";
import type {
  CustodyProvider,
  DepositAddress,
  IncomingDeposit,
  WithdrawalEvent,
  WithdrawalResult,
} from "./types";

const BASE = "https://rest.api.cryptoapis.io/v2";

// Our network -> Crypto APIs `blockchain` identifier.
const BLOCKCHAIN: Partial<Record<Network, string>> = {
  [Network.BITCOIN]: "bitcoin",
  [Network.TRON]: "tron",
  [Network.BSC]: "binance-smart-chain",
  [Network.ETHEREUM]: "ethereum",
};

// USDT is a token (TRC-20 on TRON). Native-coin assets (BTC) are handled by the
// coins endpoints; token assets by the tokens endpoints.
const TOKEN_ASSETS = new Set<Asset>([Asset.USDT]);

/**
 * Crypto APIs custody adapter (Wallet-as-a-Service / MPC model). Keys live in
 * Crypto APIs' infrastructure; we store only the derived public address. Chosen
 * to replace Tatum, whose Virtual Accounts product is closed to new accounts.
 *
 * NOTE: This adapter is provider-correct in shape but has NOT been exercised
 * against the live Crypto APIs API in this build. The exact v2 paths, request
 * bodies and callback-signature scheme are marked below — validate them against
 * https://docs.cryptoapis.io before enabling in production. Guarded behind
 * CUSTODY_PROVIDER=cryptoapis so it is inert until configured.
 */
export class CryptoApisCustodyProvider implements CustodyProvider {
  readonly name = "cryptoapis";

  constructor(
    private readonly apiKey: string,
    private readonly walletId: string,
    private readonly webhookSecret: string,
    // Fully-qualified callback, e.g. https://…/api/webhooks/cryptoapis
    private readonly webhookUrl: string,
    private readonly network: string = "mainnet"
  ) {}

  private async call<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        "x-api-key": this.apiKey,
        "content-type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Crypto APIs ${path} failed: ${res.status} ${text}`);
    }
    return (await res.json()) as T;
  }

  async createDepositAddress(input: {
    userId: string;
    asset: Asset;
    network: Network;
  }): Promise<DepositAddress> {
    const blockchain = BLOCKCHAIN[input.network];
    if (!blockchain) {
      throw new Error(`Unsupported network for Crypto APIs: ${input.network}`);
    }

    // 1) Derive a fresh receiving address in the WaaS wallet.
    //    POST /wallet-as-a-service/wallets/{walletId}/{blockchain}/{network}/addresses
    const derived = await this.call<{ data: { item: { address: string } } }>(
      `/wallet-as-a-service/wallets/${this.walletId}/${blockchain}/${this.network}/addresses`,
      {
        method: "POST",
        body: JSON.stringify({
          context: input.userId,
          data: { item: { label: `${input.userId}:${input.asset}` } },
        }),
      }
    );
    const address = derived.data.item.address;

    // 2) Subscribe that address to confirmed-deposit callbacks. This throws on
    //    failure so we never persist a wallet we can't monitor (it's retried on
    //    the next provisioning pass). A duplicate subscription is treated OK.
    await this.subscribeAddress(blockchain, address, TOKEN_ASSETS.has(input.asset));

    return { address, custodyRef: address };
  }

  /**
   * Subscribe an address to Crypto APIs "confirmed transaction" callbacks —
   * token endpoint for TRC-20 (USDT), coin endpoint for native assets (BTC).
   *   POST /blockchain-events/{blockchain}/{network}/subscriptions/address-{coins|tokens}-transactions-confirmed
   */
  private async subscribeAddress(
    blockchain: string,
    address: string,
    isToken: boolean
  ): Promise<void> {
    const kind = isToken ? "tokens" : "coins";
    try {
      await this.call(
        `/blockchain-events/${blockchain}/${this.network}/subscriptions/address-${kind}-transactions-confirmed`,
        {
          method: "POST",
          body: JSON.stringify({
            data: {
              item: {
                address,
                callbackUrl: this.webhookUrl,
                allowDuplicates: true,
              },
            },
          }),
        }
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message.toLowerCase() : "";
      // An already-existing subscription for this address is fine.
      if (msg.includes("already") || msg.includes("duplicate")) return;
      throw err;
    }
  }

  verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
    if (!signature) return false;
    // Crypto APIs signs callbacks with your secret; verify HMAC-SHA256 over the
    // raw body, compared as base64 (header `x-signature`). Confirm the exact
    // header/encoding against the live docs when wiring keys.
    const expected = createHmac("sha256", this.webhookSecret)
      .update(rawBody)
      .digest("base64");
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  parseDepositEvent(payload: unknown): IncomingDeposit | null {
    const item = eventItem(payload);
    if (!item) return null;

    // Only credit incoming transfers.
    if (typeof item.direction === "string" && item.direction !== "incoming") {
      return null;
    }
    const address = item.address;
    const amount = item.amount;
    const txHash = item.transactionId ?? item.transactionHash;
    const blockchain = item.blockchain;
    if (
      typeof address !== "string" ||
      typeof amount !== "string" ||
      typeof txHash !== "string" ||
      typeof blockchain !== "string"
    ) {
      return null;
    }

    const network = blockchainToNetwork(blockchain);
    if (!network) return null;

    // Determine the asset: a token payload carries a symbol/contract; otherwise
    // it's the chain's native coin.
    const asset = resolveAsset(network, item);
    if (!asset) return null;

    return {
      eventId:
        (typeof item.referenceId === "string" && item.referenceId) ||
        `${txHash}:${address}`,
      address,
      amount,
      txHash,
      asset,
      network,
      // The subscription fires only once confirmed, so an omitted count is
      // treated as confirmed downstream.
      confirmations:
        typeof item.confirmations === "number" ? item.confirmations : undefined,
    };
  }

  parseWithdrawalEvent(payload: unknown): WithdrawalEvent | null {
    const item = eventItem(payload);
    if (!item) return null;
    if (item.direction !== "outgoing") return null;
    const txHash = item.transactionId ?? item.transactionHash;
    if (typeof txHash !== "string") return null;
    // A confirmed outgoing tx = completed; a failed/dropped one = failed.
    const failed =
      item.status === "failed" || item.status === "dropped" || item.failed === true;
    return {
      eventId: `withdrawal:${txHash}`,
      txHash,
      status: failed ? "failed" : "completed",
    };
  }

  async createWithdrawal(input: {
    userId: string;
    asset: Asset;
    network: Network;
    toAddress: string;
    amount: string;
  }): Promise<WithdrawalResult> {
    const blockchain = BLOCKCHAIN[input.network];
    if (!blockchain) {
      throw new Error(`Unsupported network for Crypto APIs: ${input.network}`);
    }
    // WaaS spend from the wallet. Confirm the exact transaction-request path and
    // token identifier field against the live docs when enabling.
    const res = await this.call<{
      data: { item: { transactionId?: string; transactionRequestId?: string } };
    }>(
      `/wallet-as-a-service/wallets/${this.walletId}/${blockchain}/${this.network}/transaction-requests`,
      {
        method: "POST",
        body: JSON.stringify({
          data: {
            item: {
              recipients: [{ address: input.toAddress, amount: input.amount }],
              ...(TOKEN_ASSETS.has(input.asset)
                ? { tokenType: "TRC20", contractAddress: usdtContract(input.network) }
                : {}),
            },
          },
        }),
      }
    );
    const item = res.data.item;
    return {
      txHash: item.transactionId ?? item.transactionRequestId ?? "",
      status: "broadcasting",
    };
  }
}

/** Pull the `data.item` object out of a Crypto APIs callback envelope. */
function eventItem(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== "object") return null;
  const data = (payload as Record<string, unknown>).data;
  if (!data || typeof data !== "object") return null;
  const item = (data as Record<string, unknown>).item;
  if (!item || typeof item !== "object") return null;
  // Surface referenceId (idempotency) from the envelope onto the item.
  const ref = (payload as Record<string, unknown>).referenceId;
  return { ...(item as Record<string, unknown>), referenceId: ref };
}

function blockchainToNetwork(blockchain: string): Network | null {
  switch (blockchain.toLowerCase()) {
    case "bitcoin":
      return Network.BITCOIN;
    case "tron":
      return Network.TRON;
    case "binance-smart-chain":
    case "bsc":
      return Network.BSC;
    case "ethereum":
      return Network.ETHEREUM;
    default:
      return null;
  }
}

/**
 * Resolve the credited asset from a callback item. Token payloads carry a
 * symbol; we only support USDT today. Native-coin payloads map by chain.
 */
function resolveAsset(network: Network, item: Record<string, unknown>): Asset | null {
  const symbol = typeof item.symbol === "string" ? item.symbol.toUpperCase() : undefined;
  const tokenName = typeof item.tokenName === "string" ? item.tokenName.toUpperCase() : undefined;
  if (symbol === "USDT" || tokenName === "USDT") return Asset.USDT;
  // Native coin per chain.
  if (network === Network.BITCOIN) return Asset.BTC;
  // A TRON payload without a token symbol is a native TRX transfer we don't hold.
  return null;
}

function usdtContract(network: Network): string | undefined {
  // USDT TRC-20 contract on TRON mainnet.
  if (network === Network.TRON) return "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
  return undefined;
}
