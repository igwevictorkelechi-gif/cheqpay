// apps/api/src/lib/autoCashout/index.ts
//
// Auto cash-out: a user who turns it on gets each USDT, USDC or BTC deposit
// sold for naira and paid out to their own bank account, with no taps.
//
// It is built ONLY from the paths a person already uses: the same quote and
// executeSwap as the Sell screen, and the same bank payout as the Withdraw
// screen (lib/ngnPayout.ts). So every rule still holds: spreads and the naira
// profit floor, tier limits, the daily withdrawal cap, the minimum payout, the
// withdrawal fee, and money only ever leaving to an account in the user's own
// verified name.
//
// Flow, per deposit (one row in auto_cashouts):
//   queued → sell the deposited amount → sold → pay the naira out → paid
// Each step is idempotent (fixed idempotency keys, and a lookup before any
// payout), each row is claimed with a lease so two runs never work on it at
// once, and a failure leaves the money where it is:
//   - not sold yet  → "skipped": the coins stay in the wallet;
//   - sold, not paid → "kept_ngn": the naira stays in the wallet;
//   - anything where money may have moved unrecorded → "failed", for a person.
// Temporary failures (exchange or bank unreachable) are retried with back-off.
//
// The deposit webhooks call afterDepositCredited(), which queues the row and
// runs it right after the webhook has answered. The daily cron sweeps retries.

import { after } from "next/server";
import { Asset, Prisma, TransactionStatus, TransactionType, prisma } from "@cheqpay/db";
import { ApiError } from "@/lib/http";
import { fromMinorUnits } from "@/lib/money";
import { getFeatureFlags } from "@/lib/features";
import { getWithdrawalFeeNgn, getWithdrawalMinNgn } from "@/lib/settings";
import { assertWithdrawalAllowed, sumTodayWithdrawalsNgnKobo } from "@/lib/limits";
import { withdrawalBreakdown } from "@/lib/fees";
import { MAX_TIER } from "@/lib/kyc";
import { getEnv } from "@/lib/env";
import { createConvertQuote, createQuote, executeSwap } from "@/lib/swap";
import { initiateNgnPayout } from "@/lib/ngnPayout";
import { notifyUser } from "@/lib/alerts";
import { notifyAdmins } from "@/lib/adminNotify";
import { ensureAutoCashoutSchema } from "./schema";
import {
  AUTO_CASHOUT_COINS,
  MAX_ATTEMPTS,
  classifyError,
  depositCoin,
  maskedAccount,
  retryDelaySeconds,
  shouldQueue,
  type AutoCashoutCoin,
  type AutoCashoutStatus,
} from "./rules";

/**
 * How long a run owns a row. Longer than any function can live (Vercel stops
 * a function after at most 5 minutes), so a lease only ever expires after the
 * run holding it is dead. Two runs can therefore never work on one cash-out
 * at the same time, which is what keeps a sale or payout from happening twice.
 */
const LEASE_MIN = 15;

// ---------------------------------------------------------------- settings --

export interface AutoCashoutSettings {
  enabled: boolean;
  assets: AutoCashoutCoin[];
  beneficiaryId: string | null;
}

export async function getAutoCashoutSettings(userId: string): Promise<AutoCashoutSettings> {
  await ensureAutoCashoutSchema();
  const rows = await prisma.$queryRaw<{ enabled: boolean; assets: string[]; beneficiary_id: string | null }[]>`
    SELECT enabled, assets, beneficiary_id FROM auto_cashout_settings WHERE user_id = ${userId}::uuid`;
  const r = rows[0];
  if (!r) return { enabled: false, assets: [], beneficiaryId: null };
  return {
    // Without a bank account it cannot run, whatever the switch says (the
    // account may have been deleted since, which clears the link).
    enabled: r.enabled && Boolean(r.beneficiary_id),
    assets: r.assets.filter((a): a is AutoCashoutCoin => (AUTO_CASHOUT_COINS as readonly string[]).includes(a)),
    beneficiaryId: r.beneficiary_id,
  };
}

export async function saveAutoCashoutSettings(userId: string, s: AutoCashoutSettings): Promise<void> {
  await ensureAutoCashoutSchema();
  await prisma.$executeRaw`
    INSERT INTO auto_cashout_settings (user_id, enabled, assets, beneficiary_id, updated_at)
    VALUES (${userId}::uuid, ${s.enabled}, ${s.assets}::text[], ${s.beneficiaryId}::uuid, now())
    ON CONFLICT (user_id) DO UPDATE SET enabled = EXCLUDED.enabled, assets = EXCLUDED.assets,
      beneficiary_id = EXCLUDED.beneficiary_id, updated_at = now()`;
}

export interface AutoCashoutRun {
  id: string;
  coin: string;
  asset: string;
  amount: string;
  status: AutoCashoutStatus;
  reason: string | null;
  ngn: string | null;
  payout: string | null;
  createdAt: Date;
}

export async function listAutoCashouts(userId: string, limit = 10): Promise<AutoCashoutRun[]> {
  await ensureAutoCashoutSchema();
  const rows = await prisma.$queryRaw<
    {
      id: string;
      coin: string;
      asset: string;
      amount_minor: Prisma.Decimal;
      status: AutoCashoutStatus;
      reason: string | null;
      ngn_minor: Prisma.Decimal | null;
      payout_minor: Prisma.Decimal | null;
      created_at: Date;
    }[]
  >`SELECT id, coin, asset, amount_minor, status, reason, ngn_minor, payout_minor, created_at
    FROM auto_cashouts WHERE user_id = ${userId}::uuid ORDER BY created_at DESC LIMIT ${limit}`;
  return rows.map((r) => ({
    id: r.id,
    coin: r.coin,
    asset: r.asset,
    amount: fromMinorUnits(BigInt(r.amount_minor.toFixed(0)), r.asset as Asset),
    status: r.status,
    reason: r.reason,
    ngn: r.ngn_minor === null ? null : fromMinorUnits(BigInt(r.ngn_minor.toFixed(0)), Asset.NGN),
    payout: r.payout_minor === null ? null : fromMinorUnits(BigInt(r.payout_minor.toFixed(0)), Asset.NGN),
    createdAt: r.created_at,
  }));
}

// ------------------------------------------------------------------ queue --

/**
 * Queue a just-credited deposit when its owner has auto cash-out on for that
 * coin. Returns the row id, or null when there is nothing to do. Safe to call
 * any number of times for the same deposit.
 */
export async function queueAutoCashout(depositTxId: string): Promise<string | null> {
  if (!(await getFeatureFlags()).auto_cashout) return null;
  const dep = await prisma.transaction.findUnique({
    where: { id: depositTxId },
    select: { id: true, userId: true, type: true, status: true, asset: true, amount: true, fee: true, metadata: true },
  });
  if (!dep || dep.type !== TransactionType.DEPOSIT || dep.status !== TransactionStatus.COMPLETED) return null;
  const coin = depositCoin(dep.asset, dep.metadata);
  const settings = await getAutoCashoutSettings(dep.userId);
  if (!shouldQueue(settings, coin)) return null;
  // What actually landed in the wallet: a deposit fee is withheld from the credit.
  const net = dep.amount - (dep.fee ?? 0n);
  if (net <= 0n) return null;
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO auto_cashouts (user_id, deposit_tx_id, asset, coin, amount_minor, beneficiary_id, next_attempt_at)
    VALUES (${dep.userId}::uuid, ${dep.id}::uuid, ${dep.asset}, ${coin}, ${net.toString()}::numeric,
      ${settings.beneficiaryId}::uuid, now())
    ON CONFLICT (deposit_tx_id) DO NOTHING
    RETURNING id`;
  return rows[0]?.id ?? null;
}

/**
 * Called by every crypto deposit path right after a NEW credit. Never throws
 * and never delays the webhook: the deposit is already safely credited, and
 * cashing it out is a separate step that runs once the response has gone.
 */
export async function afterDepositCredited(depositTxId: string): Promise<void> {
  try {
    const id = await queueAutoCashout(depositTxId);
    if (!id) return;
    // This deposit first, then anything else that is due a retry: the Hobby
    // plan only runs the sweep cron daily, so deposits keep retries moving.
    const run = () =>
      runAutoCashouts({ id })
        .then(() => runAutoCashouts({ limit: 20, budgetMs: 30_000 }))
        .then(() => undefined, (err) => console.error("[auto-cashout] run failed", id, err));
    try {
      after(run);
    } catch {
      // Outside a request (a script or a test): run it now instead.
      await run();
    }
  } catch (err) {
    console.error("[auto-cashout] could not queue deposit", depositTxId, err);
  }
}

// -------------------------------------------------------------------- run --

interface Row {
  id: string;
  user_id: string;
  deposit_tx_id: string;
  asset: string;
  coin: AutoCashoutCoin;
  amount_minor: Prisma.Decimal;
  beneficiary_id: string | null;
  status: AutoCashoutStatus;
  swap_tx_id: string | null;
  ngn_minor: Prisma.Decimal | null;
  attempts: number;
}

export interface AutoCashoutSummary {
  processed: number;
  paid: number;
  waiting: number;
  stopped: number;
}

/** Work due rows (or just `id`) until none are left or the time budget is spent. */
export async function runAutoCashouts(opts: { id?: string; budgetMs?: number; limit?: number } = {}): Promise<AutoCashoutSummary> {
  await ensureAutoCashoutSchema();
  const deadline = Date.now() + (opts.budgetMs ?? 120_000);
  const limit = opts.limit ?? 200;
  const summary: AutoCashoutSummary = { processed: 0, paid: 0, waiting: 0, stopped: 0 };
  while (Date.now() < deadline && summary.processed < limit) {
    const row = await claimNext(opts.id);
    if (!row) break;
    summary.processed++;
    const status = await processRow(row);
    if (status === "paid") summary.paid++;
    else if (status === "queued" || status === "sold") summary.waiting++;
    else summary.stopped++;
  }
  return summary;
}

async function claimNext(id?: string): Promise<Row | null> {
  const rows = await prisma.$queryRaw<Row[]>`
    UPDATE auto_cashouts c SET locked_until = now() + make_interval(mins => ${LEASE_MIN}), updated_at = now()
    WHERE c.id = (
      SELECT c2.id FROM auto_cashouts c2
      WHERE c2.status IN ('queued', 'sold')
        AND (${id ?? null}::uuid IS NULL OR c2.id = ${id ?? null}::uuid)
        AND (c2.next_attempt_at IS NULL OR c2.next_attempt_at <= now())
        AND (c2.locked_until IS NULL OR c2.locked_until < now())
      ORDER BY c2.created_at
      LIMIT 1
      FOR UPDATE OF c2 SKIP LOCKED
    )
    RETURNING c.id, c.user_id, c.deposit_tx_id, c.asset, c.coin, c.amount_minor, c.beneficiary_id,
      c.status, c.swap_tx_id, c.ngn_minor, c.attempts`;
  return rows[0] ?? null;
}

/** A definite "no" that leaves the money where it is. */
class Stop extends Error {}

/** Money may have moved without a record: never retried, a person checks it. */
class Danger extends Error {}

/**
 * executeSwap errors that are raised before anything moved, or after the
 * exchange was refused and the coins put back. Only after one of these may the
 * sale be tried again.
 */
const SALE_NOTHING_MOVED = new Set([
  "no_quote",
  "quote_consumed",
  "quote_expired",
  "insufficient_funds",
  "fx_failed",
]);

const swapKey = (id: string) => `autocash:swap:${id}`;

async function processRow(row: Row): Promise<AutoCashoutStatus> {
  try {
    let ngnMinor = row.ngn_minor === null ? null : BigInt(row.ngn_minor.toFixed(0));
    if (row.status === "queued") {
      ngnMinor = await sell(row);
    }
    return await payOut(row, ngnMinor as bigint);
  } catch (err) {
    return handleFailure(row, err);
  }
}

/** Step 1: sell exactly what the deposit credited. Returns the naira it made. */
async function sell(row: Row): Promise<bigint> {
  const flags = await getFeatureFlags();
  if (!flags.auto_cashout) throw new Stop("Auto cash-out is paused right now.");
  if (!flags.crypto_trading) throw new Stop("Selling crypto is paused right now.");
  if (!flags.ngn_withdrawals) throw new Stop("Bank withdrawals are paused right now.");

  // Settings are read again: the user may have turned it off since the deposit.
  const settings = await getAutoCashoutSettings(row.user_id);
  if (!settings.enabled || !settings.assets.includes(row.coin)) {
    throw new Stop(`Auto cash-out for ${row.coin} was turned off before it ran.`);
  }
  if (!settings.beneficiaryId) throw new Stop("No bank account is set for auto cash-out.");

  // A retry after a sale that went through but was not recorded here: use it.
  const done = await prisma.transaction.findUnique({ where: { idempotencyKey: swapKey(row.id) } });
  if (done) return markSold(row, done.id, done.metadata);

  const user = await prisma.user.findUnique({ where: { id: row.user_id }, select: { kycTier: true, legalName: true } });
  if (!user) throw new Stop("Account not found.");
  if (!(user.legalName ?? "").trim()) throw new Stop("Complete identity verification to use auto cash-out.");

  const asset = row.asset as Asset;
  const amountInMinor = BigInt(row.amount_minor.toFixed(0));
  const bal = await prisma.balance.findUnique({ where: { userId_asset: { userId: row.user_id, asset } } });
  if (!bal || bal.available < amountInMinor) {
    throw new Stop(`The ${row.coin} from this deposit is no longer in your wallet.`);
  }

  const quote =
    asset === Asset.USD
      ? await createConvertQuote({ userId: row.user_id, tier: user.kycTier, fromAsset: Asset.USD, toAsset: Asset.NGN, amountInMinor })
      : await createQuote({ userId: row.user_id, tier: user.kycTier, side: "sell", cryptoAsset: asset, amountInMinor });

  // Before selling, make sure the naira could actually be paid out — a person
  // who wanted cash in the bank should not be left holding naira instead.
  const minNgn = await getWithdrawalMinNgn();
  if (minNgn > 0 && quote.amountOut < BigInt(minNgn) * 100n) {
    throw new Stop(
      `₦${fromMinorUnits(quote.amountOut, Asset.NGN)} is under the ₦${minNgn.toLocaleString("en-NG")} minimum payout, so it was left as ${row.coin}.`,
    );
  }
  const feeMinor = BigInt(Math.round((await getWithdrawalFeeNgn()) * 100));
  const { payoutMinor } = withdrawalBreakdown(quote.amountOut, feeMinor);
  const tier = getEnv().RELAX_WITHDRAWAL_GUARDS ? MAX_TIER : user.kycTier;
  try {
    assertWithdrawalAllowed(tier, payoutMinor, await sumTodayWithdrawalsNgnKobo(row.user_id));
  } catch (err) {
    if (err instanceof ApiError) throw new Stop(`${err.message}, so it was left as ${row.coin}.`);
    throw err;
  }

  // Record the intent before the point of no return. If an earlier attempt
  // already set it and left no sale on record (checked above), that attempt's
  // outcome is unknown: selling again could sell twice, so a person decides.
  const started = await prisma.$executeRaw`
    UPDATE auto_cashouts SET sale_started_at = now(), updated_at = now()
    WHERE id = ${row.id}::uuid AND sale_started_at IS NULL`;
  if (started !== 1) {
    throw new Danger("An earlier sale attempt has no record of finishing; not selling again until it is checked.");
  }
  let res: { transactionId: string };
  try {
    res = await executeSwap({ userId: row.user_id, quoteId: quote.id, idempotencyKey: swapKey(row.id) });
  } catch (err) {
    const code = (err as { code?: unknown } | null)?.code;
    if (typeof code === "string" && SALE_NOTHING_MOVED.has(code)) {
      await prisma.$executeRaw`UPDATE auto_cashouts SET sale_started_at = NULL WHERE id = ${row.id}::uuid`;
    }
    throw err;
  }
  const swap = await prisma.transaction.findUnique({ where: { id: res.transactionId } });
  return markSold(row, res.transactionId, swap?.metadata ?? null, quote.amountOut);
}

async function markSold(row: Row, swapTxId: string, metadata: unknown, fallbackNgn?: bigint): Promise<bigint> {
  // The naira actually credited (the FX rail credits what settled, which can
  // differ from the quote), recorded on the swap as amountOut.
  const recorded = (metadata as { amountOut?: unknown } | null)?.amountOut;
  const ngn = typeof recorded === "string" && /^\d+$/.test(recorded) ? BigInt(recorded) : fallbackNgn;
  if (ngn === undefined) throw new Error(`swap ${swapTxId} has no amountOut`);
  await prisma.$executeRaw`
    UPDATE auto_cashouts SET status = 'sold', swap_tx_id = ${swapTxId}::uuid, ngn_minor = ${ngn.toString()}::numeric,
      attempts = 0, reason = NULL, updated_at = now()
    WHERE id = ${row.id}::uuid`;
  row.status = "sold";
  row.attempts = 0;
  return ngn;
}

/** Step 2: send the naira from the sale to the user's own bank account. */
async function payOut(row: Row, ngnMinor: bigint): Promise<AutoCashoutStatus> {
  // A payout from an earlier attempt that is in flight or done must never be
  // repeated — whatever this row says.
  const prior = await prisma.transaction.findFirst({
    where: {
      userId: row.user_id,
      type: TransactionType.WITHDRAWAL,
      status: { in: [TransactionStatus.PROCESSING, TransactionStatus.COMPLETED] },
      metadata: { path: ["autoCashoutId"], equals: row.id },
    },
  });
  if (prior) return markPaid(row, prior.id, prior.amount, null);

  const flags = await getFeatureFlags();
  if (!flags.ngn_withdrawals) throw new Stop("Bank withdrawals are paused right now, so the naira is in your wallet.");

  const ben = row.beneficiary_id
    ? await prisma.beneficiary.findFirst({ where: { id: row.beneficiary_id, userId: row.user_id } })
    : null;
  if (!ben) throw new Stop("The bank account for auto cash-out was removed, so the naira is in your wallet.");
  const user = await prisma.user.findUnique({ where: { id: row.user_id }, select: { id: true, legalName: true, kycTier: true } });
  if (!user) throw new Stop("Account not found.");

  const out = await initiateNgnPayout({
    user,
    bankCode: ben.bankCode,
    accountNumber: ben.accountNumber,
    narration: "CheqPay auto cash-out",
    requestedMinor: ngnMinor,
    feeInclusive: true,
    // One key per attempt: an attempt only repeats after the last one was
    // definitely refused (or never debited), which the lookup above enforces.
    idempotencyKey: `autocash:payout:${row.id}:${row.attempts}`,
    extraMetadata: { autoCashoutId: row.id },
  });
  return markPaid(row, out.transactionId, out.amountMinor, maskedAccount(ben.bankName, ben.accountNumber));
}

async function markPaid(row: Row, payoutTxId: string, payoutMinor: bigint, account: string | null): Promise<AutoCashoutStatus> {
  const updated = await prisma.$executeRaw`
    UPDATE auto_cashouts SET status = 'paid', payout_tx_id = ${payoutTxId}::uuid,
      payout_minor = ${payoutMinor.toString()}::numeric, reason = NULL, locked_until = NULL, updated_at = now()
    WHERE id = ${row.id}::uuid AND status <> 'paid'`;
  if (updated === 1 && account) {
    const ngn = row.ngn_minor === null ? null : BigInt(row.ngn_minor.toFixed(0));
    await notifyUser(row.user_id, {
      category: "withdrawals",
      title: "Auto cash-out on its way",
      body: `Your ${row.coin} deposit was sold${ngn !== null ? ` for ₦${fromMinorUnits(ngn, Asset.NGN)}` : ""}. ₦${fromMinorUnits(payoutMinor, Asset.NGN)} is on its way to ${account}.`,
      data: { transactionId: payoutTxId },
    }).catch(() => undefined);
  }
  return "paid";
}

async function handleFailure(row: Row, err: unknown): Promise<AutoCashoutStatus> {
  const sold = row.status === "sold";
  const message = err instanceof Error ? err.message : String(err);
  const kind = err instanceof Stop ? "stop" : err instanceof Danger ? "danger" : classifyError(err);
  const attempts = row.attempts + 1;

  if (kind === "retry" && attempts < MAX_ATTEMPTS) {
    await prisma.$executeRaw`
      UPDATE auto_cashouts SET attempts = ${attempts}, reason = ${message.slice(0, 500)}, locked_until = NULL,
        next_attempt_at = now() + make_interval(secs => ${retryDelaySeconds(attempts)}), updated_at = now()
      WHERE id = ${row.id}::uuid`;
    return row.status;
  }

  const status: AutoCashoutStatus = kind === "danger" ? "failed" : sold ? "kept_ngn" : "skipped";
  const reason =
    kind === "danger"
      ? "Something went wrong mid-sale. Our team is checking it — no action is needed from you."
      : kind === "retry"
      ? sold
        ? "We couldn't reach the bank after several tries, so the naira is in your wallet."
        : "We couldn't reach the exchange after several tries, so your crypto is in your wallet."
      : message;
  await prisma.$executeRaw`
    UPDATE auto_cashouts SET status = ${status}, attempts = ${attempts}, reason = ${reason.slice(0, 500)},
      locked_until = NULL, updated_at = now()
    WHERE id = ${row.id}::uuid`;

  await notifyUser(row.user_id, {
    category: sold ? "withdrawals" : "trades",
    title: sold ? "Auto cash-out: naira kept in your wallet" : `Auto cash-out: ${row.coin} kept in your wallet`,
    body: reason,
    data: {},
  }).catch(() => undefined);
  // A person looks at anything that wasn't a plain "no": exchange or bank
  // trouble that outlasted the retries, and above all money that may have
  // moved without a record.
  if (kind !== "stop") {
    await notifyAdmins({
      title: status === "failed" ? "Auto cash-out needs checking" : "Auto cash-out gave up",
      body: `${row.coin} for user ${row.user_id}: ${message}`.slice(0, 300),
      rows: [
        ["Auto cash-out", row.id],
        ["User", row.user_id],
        ["Coin", row.coin],
        ["Outcome", status],
        ["Error", message.slice(0, 300)],
      ],
      where: "Transactions",
      emailSubject: "Auto cash-out problem",
      data: { autoCashoutId: row.id },
      icon: "⚠️",
      section: "transactions",
      url: "/transactions",
    }).catch(() => undefined);
  }
  return status;
}
