// apps/api/src/lib/maplerad/cryptoCollection.ts
//
// Crediting a stablecoin deposit that arrives as a COLLECTION.
//
// Maplerad does not send crypto deposits under `crypto.*` as we assumed. A live
// USDT deposit arrived as `collection.successful`, and verifying it returned:
//
//   { type: "COLLECTION", channel: "CRYPTO", currency: "USDT", amount: 1000,
//     account_id: null, reference: "0x9ef2…"  (the chain tx hash),
//     summary: "USDT Deposit | BSC | 0xEB2d…",
//     source: { bank_name: "BSC", account_number: "0xEB2d…" (the SENDER) },
//     customer: { id: … } }
//
// The fiat collection path could not place it: it maps only NGN and USD, so the
// deposit was classified "unsupported currency" and ignored while the money sat
// in the customer's wallet. Three things make this shape awkward, and each is
// handled explicitly below rather than guessed at:
//
//  - `account_id` is null, so the destination account cannot identify the owner.
//    `customer.id` can, and does.
//  - `source` is the SENDER's address, not ours — matching a wallet on it would
//    find nothing.
//  - the chain is only in `source.bank_name` / the summary text.

import { Asset, Network, TransactionType, prisma } from "@cheqpay/db";
import { creditBalance } from "../ledger";
import { notifyUser } from "../alerts";
import { ASSET_DECIMALS, fromMinorUnits } from "../money";
import { isWithdrawableNetwork } from "../assets";
import { ensureUsdAsset } from "../ensureUsdAsset";
import { cryptoDepositFee } from "../fees";
import { getPricing } from "../settings";
import type { CreditResult } from "./deposits";
import type { VerifiedTransaction } from "./transactions";

/**
 * Maplerad states dollar-denominated amounts in 2-decimal minor units, the same
 * as USD — a stablecoin is a currency to them, not a token with chain decimals.
 * Our own USDT/USDC balances are stored at 6dp, so an amount crossing this
 * boundary must be scaled; getting it wrong is a 10,000x error.
 */
const PROVIDER_DECIMALS = 2;

/** Is this a stablecoin collection rather than a fiat one? */
export function isCryptoCollection(tx: VerifiedTransaction): boolean {
  if ((tx.channel ?? "").toUpperCase() === "CRYPTO") return true;
  return coinFor(tx.currency) !== null;
}

/** The coin a currency names, or null when it is not one we carry. */
export function coinFor(currency?: string): Asset | null {
  switch ((currency ?? "").toUpperCase()) {
    case "USDT":
      return Asset.USDT;
    case "USDC":
      return Asset.USDC;
    default:
      return null;
  }
}

/** The chain, read from the provider's wording. Null when unrecognisable. */
export function networkFor(raw?: string | null): Network | null {
  const s = (raw ?? "").trim().toUpperCase();
  if (!s) return null;
  if (/^(BSC|BEP.?20|BINANCE)/.test(s)) return Network.BSC;
  if (/^(SOL|SOLANA)/.test(s)) return Network.SOLANA;
  if (/^(TRX|TRON|TRC.?20)/.test(s)) return Network.TRON;
  if (/^(ETH|ERC.?20|ETHEREUM)/.test(s)) return Network.ETHEREUM;
  if (/^(POLYGON|MATIC)/.test(s)) return Network.POLYGON;
  if (/^BASE/.test(s)) return Network.BASE;
  return null;
}

/**
 * Convert the provider's 2dp amount into minor units of `asset`.
 *
 * Exact by construction: scaling up multiplies, scaling down would lose
 * precision so it is refused rather than rounded — we would rather leave a
 * deposit for a human than credit a silently truncated amount.
 */
export function toAssetMinor(providerMinor: number, asset: Asset): bigint | null {
  if (!Number.isFinite(providerMinor) || providerMinor <= 0) return null;
  if (!Number.isInteger(providerMinor)) return null;
  const decimals = ASSET_DECIMALS[asset];
  if (decimals >= PROVIDER_DECIMALS) {
    return BigInt(providerMinor) * 10n ** BigInt(decimals - PROVIDER_DECIMALS);
  }
  const divisor = 10n ** BigInt(PROVIDER_DECIMALS - decimals);
  const value = BigInt(providerMinor);
  return value % divisor === 0n ? value / divisor : null;
}

/** Keys any other path might already have credited this deposit under. */
function candidateKeys(tx: VerifiedTransaction): string[] {
  const keys = [`deposit:maplerad:${tx.id}`, `deposit:maplerad:crypto:${tx.id}`];
  // The crypto webhook path keys on whatever it read as the provider id, which
  // for a chain deposit is the tx hash sitting in `reference`.
  if (typeof tx.reference === "string" && tx.reference) {
    keys.push(`deposit:maplerad:crypto:${tx.reference}`);
  }
  return keys;
}

/** Everything needed to credit a crypto collection, or why it cannot be. */
export interface CryptoPlan {
  userId: string;
  coin: Asset;
  network: Network;
  /** What actually lands: USD when the chain cannot be withdrawn from. */
  asset: Asset;
  offramp: boolean;
  amountMinor: bigint;
}

export type CryptoPlanResult =
  | { ok: true; plan: CryptoPlan }
  | { ok: false; outcome: "ignored" | "unmatched"; reason: string };

/**
 * Work out who owns a stablecoin collection and what should land, without
 * writing anything.
 *
 * Shared deliberately: the webhook credits from this and the admin
 * reconciliation preview classifies from it, so what an operator is shown is
 * exactly what an auto-credit would do. Two paths reading the same payload
 * differently is what left this deposit showing "unsupported currency" in the
 * panel while the webhook had already been taught to handle it.
 */
export async function resolveCryptoPlan(
  tx: VerifiedTransaction,
): Promise<CryptoPlanResult> {
  const coin = coinFor(tx.currency);
  if (!coin) {
    return { ok: false, outcome: "ignored", reason: `unsupported coin ${tx.currency ?? "?"}` };
  }

  const customerId = tx.customer?.id;
  if (!customerId) {
    return { ok: false, outcome: "unmatched", reason: "no customer on the transaction" };
  }

  const user = await prisma.user.findFirst({
    where: { mapleradCustomerId: customerId },
    select: { id: true },
  });
  if (!user) {
    return { ok: false, outcome: "unmatched", reason: "no user for this Maplerad customer" };
  }

  // The chain: stated by the provider, else inferred from the user's own
  // addresses for this coin — but only when there is exactly one, since
  // guessing between chains picks the wrong offramp rule.
  let network = networkFor(tx.source?.bank_name) ?? networkFor(tx.summary?.split("|")[1]);
  if (!network) {
    const wallets = await prisma.wallet.findMany({
      where: { userId: user.id, asset: coin },
      select: { network: true },
    });
    if (wallets.length === 1) network = wallets[0].network as Network;
  }
  if (!network) {
    return {
      ok: false,
      outcome: "unmatched",
      reason: "could not determine which chain the deposit arrived on",
    };
  }

  const offramp = !isWithdrawableNetwork(network);
  const asset = offramp ? Asset.USD : coin;

  const amountMinor = toAssetMinor(tx.amount, asset);
  if (amountMinor === null) {
    return { ok: false, outcome: "unmatched", reason: `unreadable amount ${tx.amount}` };
  }

  return { ok: true, plan: { userId: user.id, coin, network, asset, offramp, amountMinor } };
}

/** True when this deposit is already credited under any path's key. */
export async function alreadyCredited(tx: VerifiedTransaction): Promise<boolean> {
  const existing = await prisma.transaction.findFirst({
    where: { idempotencyKey: { in: candidateKeys(tx) } },
    select: { id: true },
  });
  return existing !== null;
}

/**
 * Credit a verified stablecoin collection to its owner.
 *
 * Ownership comes from `customer.id`. The chain decides what actually lands: a
 * coin on a chain we cannot withdraw from could only have been minted as an
 * offramp address, so the arrival is dollars — crediting coin there would give
 * the user a balance they can never move. That is the same rule the crypto
 * webhook path applies.
 */
export async function creditCryptoCollection(
  tx: VerifiedTransaction,
): Promise<CreditResult> {
  const resolved = await resolveCryptoPlan(tx);
  if (!resolved.ok) return { outcome: resolved.outcome, reason: resolved.reason };
  const { userId, coin, network, asset, offramp, amountMinor } = resolved.plan;

  if (await alreadyCredited(tx)) return { outcome: "duplicate", userId };

  if (asset === Asset.USD) await ensureUsdAsset();

  // A coin that lands as dollars went through Maplerad's ramp, which keeps its
  // cut out of our business wallet. Without charging our conversion fee here
  // every offramped deposit cost us that cut — this is the path live deposits
  // actually take, so it must price them the same as cryptoDeposits.ts does.
  // A coin credited as itself costs us nothing.
  const feeMinor = asset === Asset.USD ? cryptoDepositFee(amountMinor, await getPricing()) : 0n;

  const { created, transactionId } = await creditBalance({
    userId,
    asset,
    amountMinor,
    feeMinor,
    type: TransactionType.DEPOSIT,
    idempotencyKey: `deposit:maplerad:${tx.id}`,
    network,
    txHash: typeof tx.reference === "string" ? tx.reference : undefined,
    externalRef: tx.id,
    metadata: {
      source: "crypto_collection",
      provider: "maplerad",
      coin,
      chain: network,
      currency: asset,
      offramp,
      providerAmountMinor: tx.amount,
      eventId: tx.id,
    },
  });

  if (!created) return { outcome: "duplicate", userId, amount: tx.amount };

  await notifyUser(userId, {
    category: "deposits",
    title: "Deposit received",
    body: offramp
      ? feeMinor > 0n
        ? `Your ${coin} deposit was converted and $${fromMinorUnits(amountMinor - feeMinor, asset)} added to your balance ($${fromMinorUnits(feeMinor, asset)} conversion fee).`
        : `Your ${coin} deposit was converted and $${fromMinorUnits(amountMinor, asset)} added to your balance.`
      : `${fromMinorUnits(amountMinor, asset)} ${coin} has landed in your wallet.`,
    data: { transactionId },
  }).catch(() => undefined);

  return { outcome: "credited", userId, amount: tx.amount };
}
