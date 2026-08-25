// apps/api/src/lib/maplerad/cryptoDeposits.ts
//
// Crediting for stablecoin deposits (crypto.* webhook events).
//
// Maplerad's crypto webhook payload has never been observed against a real
// deposit — their sandbox address endpoint was broken — so this parser is
// deliberately tolerant about WHERE each field lives, and deliberately strict
// about WHAT it will act on. It reads several plausible key names for the same
// value, and refuses to credit anything it cannot pin down: an unmatched
// deposit is logged for a human, never credited to a guess.

import { Asset, Network, TransactionType, prisma } from "@cheqpay/db";
import { creditBalance } from "../ledger";
import { notifyUser } from "../alerts";
import { fromMinorUnits } from "../money";
import { ASSET_DECIMALS } from "../money";

/** A crypto deposit reduced to the few things crediting actually needs. */
export interface ParsedCryptoDeposit {
  address: string;
  /** Coin code as the provider spells it (usdc/USDC/usdt…). */
  coin: string;
  /** Raw amount exactly as sent, before unit interpretation. */
  rawAmount: string;
  chain?: string;
  providerTxId: string;
  status: string;
  /** True when the provider converted the arrival to USD for us. */
  offramp: boolean;
}

/** Statuses that mean "the money is really here". */
const CREDITABLE = new Set(["SUCCESS", "SUCCESSFUL", "COMPLETED", "CONFIRMED", "SETTLED"]);

type Bag = Record<string, unknown>;

function asBag(v: unknown): Bag {
  return v && typeof v === "object" ? (v as Bag) : {};
}

/** First present, non-empty string across several candidate keys. */
function pick(bags: Bag[], keys: string[]): string | undefined {
  for (const bag of bags) {
    for (const k of keys) {
      const v = bag[k];
      if (typeof v === "string" && v.trim()) return v.trim();
      if (typeof v === "number" && Number.isFinite(v)) return String(v);
    }
  }
  return undefined;
}

function pickBool(bags: Bag[], keys: string[]): boolean {
  for (const bag of bags) {
    for (const k of keys) {
      if (typeof bag[k] === "boolean") return bag[k] as boolean;
    }
  }
  return false;
}

/**
 * Pull a deposit out of whatever shape the event arrived in.
 *
 * Returns null when a field crediting cannot do without is missing — better to
 * log the whole payload for a human than to invent a value.
 */
export function parseCryptoDeposit(event: unknown): ParsedCryptoDeposit | null {
  const root = asBag(event);
  const data = asBag(root.data);
  // Some providers nest the interesting part one level deeper.
  const inner = asBag(data.transaction ?? data.deposit ?? data.crypto);
  const bags = [data, inner, root];

  const address = pick(bags, ["address", "to_address", "destination_address", "wallet_address", "to"]);
  const coin = pick(bags, ["coin", "currency", "asset", "token"]);
  const rawAmount = pick(bags, ["amount", "value", "amount_paid", "credited_amount"]);
  const providerTxId = pick(bags, ["id", "hash", "tx_hash", "transaction_hash", "reference", "blockchain_memo"]);

  if (!address || !coin || !rawAmount || !providerTxId) return null;

  return {
    address,
    coin,
    rawAmount,
    chain: pick(bags, ["chain", "network", "to_chain"]),
    providerTxId,
    // No status field at all is treated as settled: several providers only emit
    // a webhook once the deposit has confirmed.
    status: (pick(bags, ["status", "state"]) ?? "SUCCESS").toUpperCase(),
    offramp: pickBool(bags, ["offramp", "off_ramp", "auto_convert"]),
  };
}

/** Map a provider coin code onto our Asset, or null if we do not carry it. */
export function assetForCoin(coin: string): Asset | null {
  switch (coin.trim().toUpperCase()) {
    case "USDT":
      return Asset.USDT;
    case "USDC":
      return Asset.USDC;
    case "USD":
      return Asset.USD;
    default:
      return null;
  }
}

/**
 * Interpret the provider's amount as minor units of `asset`.
 *
 * A decimal point is unambiguous — "12.5" is whole units, always. A bare
 * integer is the dangerous case: it could be minor units or whole units, and
 * guessing wrong moves the balance by a factor of a million. Maplerad states
 * amounts in the currency's lowest denomination everywhere else in their API
 * (collections and FX both), so a bare integer is read the same way here.
 */
export function toMinor(rawAmount: string, asset: Asset): bigint | null {
  const s = rawAmount.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const decimals = ASSET_DECIMALS[asset];

  if (s.includes(".")) {
    const [whole, frac = ""] = s.split(".");
    const padded = (frac + "0".repeat(decimals)).slice(0, decimals);
    const combined = `${whole}${padded}`.replace(/^0+(?=\d)/, "");
    return BigInt(combined);
  }
  return BigInt(s);
}

export interface CryptoCreditOutcome {
  outcome: "credited" | "duplicate" | "ignored" | "unmatched";
  reason?: string;
  transactionId?: string;
  userId?: string;
}

/**
 * Credit a parsed stablecoin deposit to the address's owner.
 *
 * Ownership comes from the deposit address: it was minted for exactly one user,
 * so the address IS the identity. An address we do not know is left unmatched
 * for a human rather than credited to anyone.
 */
export async function creditCryptoDeposit(
  deposit: ParsedCryptoDeposit
): Promise<CryptoCreditOutcome> {
  if (!CREDITABLE.has(deposit.status)) {
    return { outcome: "ignored", reason: `status ${deposit.status}` };
  }

  // The address identifies the owner. Case-insensitive because EVM addresses
  // are commonly echoed back with different capitalisation than they were
  // minted with; Solana addresses are case-sensitive but exact-match anyway.
  const wallet = await prisma.wallet.findFirst({
    where: { address: { equals: deposit.address, mode: "insensitive" } },
    select: { userId: true, asset: true, network: true },
  });
  if (!wallet) return { outcome: "unmatched", reason: "no wallet for address" };

  // An offramped deposit lands as dollars regardless of the coin sent.
  const asset = deposit.offramp ? Asset.USD : assetForCoin(deposit.coin);
  if (!asset) return { outcome: "unmatched", reason: `unknown coin ${deposit.coin}` };

  const amountMinor = toMinor(deposit.rawAmount, asset);
  if (amountMinor === null || amountMinor <= 0n) {
    return { outcome: "unmatched", reason: `unreadable amount ${deposit.rawAmount}` };
  }

  const { created, transactionId } = await creditBalance({
    userId: wallet.userId,
    asset,
    amountMinor,
    type: TransactionType.DEPOSIT,
    // The provider's own id for this deposit: a webhook retry, or the same
    // deposit arriving under a second event name, cannot double-credit.
    idempotencyKey: `deposit:maplerad:crypto:${deposit.providerTxId}`,
    network: wallet.network as Network,
    txHash: deposit.providerTxId,
    metadata: {
      source: "maplerad_crypto",
      coin: deposit.coin,
      chain: deposit.chain ?? null,
      address: deposit.address,
      offramp: deposit.offramp,
    },
  });

  if (!created) return { outcome: "duplicate", transactionId, userId: wallet.userId };

  // Best-effort, after the credit is committed.
  await notifyUser(wallet.userId, {
    category: "deposits",
    title: "Deposit received",
    body:
      asset === Asset.USD
        ? `Your crypto deposit was converted and $${fromMinorUnits(amountMinor, asset)} added to your balance.`
        : `${fromMinorUnits(amountMinor, asset)} ${asset} has landed in your wallet.`,
    data: { transactionId },
  }).catch(() => undefined);

  return { outcome: "credited", transactionId, userId: wallet.userId };
}
