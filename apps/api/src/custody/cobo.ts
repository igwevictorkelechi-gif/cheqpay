import { createHash, createPublicKey, verify as edVerify } from "node:crypto";
import { Asset, Network } from "@cheqpay/db";
import * as CoboWaas2 from "@cobo/cobo-waas2";
import type {
  CustodyProvider,
  DepositAddress,
  IncomingDeposit,
  WithdrawalEvent,
  WithdrawalResult,
} from "./types";

// Our network -> Cobo chain_id. USDT is a TRC-20 token that settles at the
// TRON deposit address, so both BTC and USDT map their own chains.
const CHAIN_ID: Partial<Record<Network, string>> = {
  [Network.BITCOIN]: "BTC",
  [Network.TRON]: "TRON",
  [Network.BSC]: "BSC",
  [Network.ETHEREUM]: "ETH",
};

// Cobo token_id per asset we support (for withdrawals + deposit disambiguation).
const TOKEN_ID: Partial<Record<Asset, string>> = {
  [Asset.USDT]: "TRON_USDT",
  [Asset.BTC]: "BTC",
};

/**
 * Cobo WaaS 2.0 custody adapter (Custodial "Asset" wallet). Keys live in Cobo's
 * infrastructure; we store only the derived public address. Selected after
 * Tatum's Virtual Accounts closed and Crypto APIs' WaaS migrated to Vaultody.
 *
 * Auth (Ed25519 request signing) is handled by the official @cobo/cobo-waas2
 * SDK. NOTE: this adapter has NOT been exercised against the live API yet — the
 * chain/token ids, withdrawal request shape and callback-signature scheme are
 * marked below to validate against Cobo's free SANDBOX (api.dev.cobo.com)
 * before production. Guarded behind CUSTODY_PROVIDER=cobo.
 */
export class CoboCustodyProvider implements CustodyProvider {
  readonly name = "cobo";
  private ready = false;

  constructor(
    private readonly apiPrivateKeyHex: string,
    private readonly walletId: string,
    // "dev" (sandbox) or "prod".
    private readonly env: string,
    // Cobo's callback verification public key (hex), from the Cobo portal.
    private readonly callbackPubKeyHex: string
  ) {}

  /** Configure the shared SDK client once (Ed25519 signing + environment). */
  private ensureClient() {
    if (this.ready) return;
    const client = CoboWaas2.ApiClient.instance;
    client.setEnv(this.env === "prod" ? CoboWaas2.Env.PROD : CoboWaas2.Env.DEV);
    client.setPrivateKey(this.apiPrivateKeyHex);
    this.ready = true;
  }

  async createDepositAddress(input: {
    userId: string;
    asset: Asset;
    network: Network;
  }): Promise<DepositAddress> {
    const chainId = CHAIN_ID[input.network];
    if (!chainId) throw new Error(`Unsupported network for Cobo: ${input.network}`);
    this.ensureClient();

    const api = new CoboWaas2.WalletsApi();
    // POST /wallets/{wallet_id}/addresses -> [{ address, chain_id }]
    const res = await api.createAddress(this.walletId, {
      CreateAddressRequest: { chain_id: chainId, count: 1 },
    });
    const item = Array.isArray(res) ? res[0] : res?.data?.[0] ?? res;
    const address: string | undefined = item?.address;
    if (!address) throw new Error("Cobo createAddress returned no address");
    return { address, custodyRef: `${this.walletId}:${chainId}` };
  }

  verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
    if (!signature || !this.callbackPubKeyHex) return false;
    try {
      // Cobo signs callbacks with its Ed25519 key; verify against the portal's
      // callback public key. (Confirm signed content — raw body vs body+timestamp
      // — against the sandbox; assumed raw body here.)
      const pubKey = ed25519PublicKeyFromHex(this.callbackPubKeyHex);
      const sig = Buffer.from(signature, "hex");
      // Cobo signs the SHA-256 digest of the body.
      const digest = createHash("sha256").update(rawBody).digest();
      return edVerify(null, digest, pubKey, sig);
    } catch {
      return false;
    }
  }

  parseDepositEvent(payload: unknown): IncomingDeposit | null {
    const tx = txFromCallback(payload);
    if (!tx) return null;
    if (String(tx.type ?? "").toLowerCase() !== "deposit") return null;
    // Only credit final states.
    if (!isFinalOk(tx.status)) return null;

    const address = tx.address ?? tx.to_address;
    const amount = tx.amount != null ? String(tx.amount) : undefined;
    const txHash = tx.transaction_hash ?? tx.tx_hash ?? tx.txId;
    const chainId = tx.chain_id;
    if (typeof address !== "string" || !amount || typeof txHash !== "string") return null;

    const network = chainIdToNetwork(typeof chainId === "string" ? chainId : "");
    if (!network) return null;
    const asset = resolveAsset(network, tx);
    if (!asset) return null;

    return {
      eventId:
        (typeof tx.transaction_id === "string" && tx.transaction_id) ||
        `${txHash}:${address}`,
      address,
      amount,
      txHash,
      asset,
      network,
      // The subscription fires on confirmation, so an omitted count is treated
      // as confirmed downstream.
      confirmations:
        typeof tx.confirmed_num === "number" ? tx.confirmed_num : undefined,
    };
  }

  parseWithdrawalEvent(payload: unknown): WithdrawalEvent | null {
    const tx = txFromCallback(payload);
    if (!tx) return null;
    if (String(tx.type ?? "").toLowerCase() !== "withdrawal") return null;
    const txHash = tx.transaction_hash ?? tx.tx_hash ?? tx.txId;
    if (typeof txHash !== "string") return null;
    const status = String(tx.status ?? "").toLowerCase();
    if (isFinalOk(tx.status)) return { eventId: `withdrawal:${txHash}`, txHash, status: "completed" };
    if (status === "failed" || status === "declined")
      return { eventId: `withdrawal:${txHash}`, txHash, status: "failed" };
    return null;
  }

  async createWithdrawal(input: {
    userId: string;
    asset: Asset;
    network: Network;
    toAddress: string;
    amount: string;
  }): Promise<WithdrawalResult> {
    const tokenId = TOKEN_ID[input.asset];
    if (!tokenId) throw new Error(`Unsupported asset for Cobo: ${input.asset}`);
    this.ensureClient();

    const api = new CoboWaas2.TransactionsApi();
    // POST /transactions/transfer (source = our custodial asset wallet).
    const res = await api.createTransferTransaction({
      CreateTransferTransactionRequest: {
        request_id: `wd_${input.userId}_${Date.now()}`,
        source: { source_type: "Asset", wallet_id: this.walletId },
        token_id: tokenId,
        destination: {
          destination_type: "Address",
          account_output: { address: input.toAddress, amount: input.amount },
        },
      },
    });
    const txHash: string = res?.transaction_hash ?? res?.transaction_id ?? res?.data?.transaction_id ?? "";
    return { txHash, status: "broadcasting" };
  }
}

/** Extract the transaction object from a Cobo callback envelope. */
function txFromCallback(payload: unknown): Record<string, any> | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, any>;
  // Cobo wraps the event under `data` (CallbackMessage). Fall back to the root.
  const data = p.data ?? p;
  if (!data || typeof data !== "object") return null;
  // The transaction may be nested under `transaction` or be the data itself.
  const tx = data.transaction ?? data;
  return tx && typeof tx === "object" ? tx : null;
}

function isFinalOk(status: unknown): boolean {
  const s = String(status ?? "").toLowerCase();
  return s === "completed" || s === "success" || s === "confirmed";
}

function chainIdToNetwork(chainId: string): Network | null {
  switch (chainId.toUpperCase()) {
    case "BTC":
      return Network.BITCOIN;
    case "TRON":
    case "TRX":
      return Network.TRON;
    case "BSC":
      return Network.BSC;
    case "ETH":
      return Network.ETHEREUM;
    default:
      return null;
  }
}

function resolveAsset(network: Network, tx: Record<string, any>): Asset | null {
  const tokenId = String(tx.token_id ?? tx.coin ?? "").toUpperCase();
  if (tokenId.includes("USDT")) return Asset.USDT;
  if (network === Network.BITCOIN) return Asset.BTC;
  return null;
}

/** Build a node:crypto Ed25519 public KeyObject from a raw 32-byte hex key. */
function ed25519PublicKeyFromHex(hex: string) {
  const raw = Buffer.from(hex, "hex");
  // Wrap the raw 32-byte key in a minimal SPKI DER header for Ed25519.
  const der = Buffer.concat([
    Buffer.from("302a300506032b6570032100", "hex"),
    raw,
  ]);
  return createPublicKey({ key: der, format: "der", type: "spki" });
}
