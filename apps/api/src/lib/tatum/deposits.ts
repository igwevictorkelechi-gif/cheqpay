// apps/api/src/lib/tatum/deposits.ts
//
// Crediting for Tatum ADDRESS_EVENT notifications — the automatic, instant path
// for crypto deposits.
//
// Two rules carry all the safety here:
//
//  1. THE ADDRESS IS THE IDENTITY. Every address is derived for exactly one
//     user, so an arrival needs no guesswork about who it belongs to. An
//     address we do not know is left unmatched for a human, never credited.
//
//  2. ONLY KNOWN TOKEN CONTRACTS ARE CREDITED. On any EVM chain anyone can
//     deploy a token that calls itself "USDT" and send it for free. Crediting
//     on the symbol would mint real balance out of a worthless token, so a
//     token deposit is credited only when its CONTRACT matches the official one
//     for that chain. Everything else is logged and ignored.

import { Asset, Network, TransactionType, prisma } from "@cheqpay/db";
import { creditBalance } from "../ledger";
import { notifyUser } from "../alerts";
import { fromMinorUnits, ASSET_DECIMALS } from "../money";
import { TATUM_CHAINS } from "./config";

/** Official mainnet token contracts, lowercased. Nothing else is credited. */
const TOKEN_CONTRACTS: Partial<Record<Network, Record<string, Asset>>> = {
  [Network.BSC]: {
    "0x55d398326f99059ff775485246999027b3197955": Asset.USDT,
    "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d": Asset.USDC,
  },
  [Network.ETHEREUM]: {
    "0xdac17f958d2ee523a2206206994597c13d831ec7": Asset.USDT,
    "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": Asset.USDC,
  },
  [Network.POLYGON]: {
    "0xc2132d05d31c914a87c6611c10748aeb04b58e8f": Asset.USDT,
    "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359": Asset.USDC,
    "0x2791bca1f2de4661ed88a30c99a7a9449aa84174": Asset.USDC, // bridged USDC.e
  },
  [Network.TRON]: {
    tr7nhqjekqxgtci8q8zy4pl8otszgjlj6t: Asset.USDT,
    tekxitehnzsmse2xqrbj4w32run966rdz8: Asset.USDC,
  },
};

/** Native coins we actually carry a balance for. */
const NATIVE_ASSETS: Partial<Record<Network, Asset>> = {
  [Network.BITCOIN]: Asset.BTC,
};

export interface ParsedTatumDeposit {
  address: string;
  network: Network;
  /** Whole-unit decimal string exactly as Tatum sent it. */
  amount: string;
  /** "native" | "token" | … */
  type: string;
  /** Contract address for token transfers (lowercased), when present. */
  contract?: string;
  asset?: string;
  txId: string;
}

type Bag = Record<string, unknown>;
const asBag = (v: unknown): Bag => (v && typeof v === "object" ? (v as Bag) : {});

function str(bag: Bag, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = bag[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return undefined;
}

/** Map Tatum's chain string ("bsc-mainnet") onto our Network. */
export function networkForChain(chain: string): Network | null {
  const c = chain.trim().toLowerCase();
  for (const [network, def] of Object.entries(TATUM_CHAINS)) {
    if (def && c.startsWith(def.notifyPrefix)) return network as Network;
  }
  return null;
}

/**
 * Reduce a notification to what crediting needs, or null when a required field
 * is missing. Tolerant about where fields live; strict about acting.
 */
export function parseTatumDeposit(event: unknown): ParsedTatumDeposit | null {
  const root = asBag(event);
  const data = asBag(root.data);
  const bag: Bag = { ...data, ...root };

  const address = str(bag, ["address", "to"]);
  const amount = str(bag, ["amount", "value"]);
  const txId = str(bag, ["txId", "txid", "hash", "transactionHash"]);
  const chain = str(bag, ["chain", "network"]);
  if (!address || !amount || !txId || !chain) return null;

  const network = networkForChain(chain);
  if (!network) return null;

  const contract = str(bag, ["contractAddress", "contract"]);
  return {
    address,
    network,
    amount,
    type: (str(bag, ["kind", "type"]) ?? "native").toLowerCase(),
    contract: contract ? contract.toLowerCase() : undefined,
    asset: str(bag, ["asset", "currency"]),
    txId,
  };
}

/**
 * Whole units -> minor units.
 *
 * Tatum states notification amounts in WHOLE currency units already decimal-
 * adjusted ("1.5" = 1.5 USDT), unlike Maplerad which states minor units. A bare
 * integer here is therefore whole units too — reading it the other way would be
 * a factor-of-a-million error, so this never guesses.
 */
export function wholeToMinor(amount: string, asset: Asset): bigint | null {
  const s = amount.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const decimals = ASSET_DECIMALS[asset];
  const [whole, frac = ""] = s.split(".");
  if (frac.length > decimals) {
    // More precision than the asset has: truncate rather than reject — the
    // chain can carry more decimals than our ledger does (e.g. 18 on BEP-20).
    return BigInt(`${whole}${frac.slice(0, decimals)}`.replace(/^0+(?=\d)/, "") || "0");
  }
  const padded = (frac + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(`${whole}${padded}`.replace(/^0+(?=\d)/, "") || "0");
}

/** Which asset, if any, this arrival should credit. */
export function assetForDeposit(d: ParsedTatumDeposit): Asset | null {
  if (d.type === "token" || d.contract) {
    const table = TOKEN_CONTRACTS[d.network];
    // The contract can arrive under `contractAddress` or, on some payloads, as
    // `asset`. Either way it must be an official contract to be credited.
    const candidate = (d.contract ?? d.asset ?? "").toLowerCase();
    return (table && table[candidate]) ?? null;
  }
  if (d.type === "native") return NATIVE_ASSETS[d.network] ?? null;
  return null; // erc721 / erc1155 / internal / fee — never a balance credit
}

export interface TatumCreditOutcome {
  outcome: "credited" | "duplicate" | "ignored" | "unmatched";
  reason?: string;
  transactionId?: string;
  userId?: string;
}

/** Credit a parsed deposit to the address's owner. Idempotent per transfer. */
export async function creditTatumDeposit(
  d: ParsedTatumDeposit,
): Promise<TatumCreditOutcome> {
  const asset = assetForDeposit(d);
  if (!asset) {
    return {
      outcome: "ignored",
      reason: `unrecognised ${d.type} ${d.contract ?? d.asset ?? ""} on ${d.network}`.trim(),
    };
  }

  // EVM addresses come back in mixed capitalisation; Tron/BTC are exact anyway.
  const wallet = await prisma.wallet.findFirst({
    where: { network: d.network, address: { equals: d.address, mode: "insensitive" } },
    select: { userId: true },
  });
  if (!wallet) return { outcome: "unmatched", reason: "no wallet for address" };

  const amountMinor = wholeToMinor(d.amount, asset);
  if (amountMinor === null || amountMinor <= 0n) {
    return { outcome: "unmatched", reason: `unreadable amount ${d.amount}` };
  }

  const { created, transactionId } = await creditBalance({
    userId: wallet.userId,
    asset,
    amountMinor,
    type: TransactionType.DEPOSIT,
    // txId alone is not enough: one transaction can pay several of our
    // addresses. Including the address (and amount) keeps distinct transfers
    // distinct while a retried delivery — identical in every field — dedupes.
    idempotencyKey: `deposit:tatum:${d.txId}:${d.address.toLowerCase()}:${d.amount}`,
    network: d.network,
    txHash: d.txId,
    metadata: {
      source: "tatum",
      chain: d.network,
      contract: d.contract ?? null,
      type: d.type,
      address: d.address,
    },
  });

  if (!created) return { outcome: "duplicate", transactionId, userId: wallet.userId };

  await notifyUser(wallet.userId, {
    category: "deposits",
    title: "Deposit received",
    body: `${fromMinorUnits(amountMinor, asset)} ${asset} has landed in your wallet.`,
    data: { transactionId },
  }).catch(() => undefined);

  return { outcome: "credited", transactionId, userId: wallet.userId };
}
