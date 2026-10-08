// apps/api/src/lib/devapi/ledger.ts
//
// The developer ledger: wallets, transactions and append-only entries.
//
// Every change to a wallet balance goes through applyLegs, inside the caller's
// database transaction, and leaves an entry recording the signed amount and the
// balance after it. That gives three independent guarantees:
//
//   1. no wallet goes negative: the UPDATE is guarded and a CHECK backs it;
//   2. nothing applies twice: an entry is unique per (transaction, wallet, kind),
//      so a retry that reaches the same movement fails instead of repeating it;
//   3. the balance is provable: it must equal the sum of its entries, which the
//      daily reconciliation checks (and freezes the wallet if it doesn't).
//
// Wallets are locked in id order before any balance changes, so two transfers
// in opposite directions between the same wallets can't deadlock. The lock is
// FOR NO KEY UPDATE, not FOR UPDATE: inserting a transaction row that
// references a wallet takes a KEY SHARE lock on it (the foreign-key check), and
// FOR UPDATE conflicts with that — fifty parallel payments from one wallet
// deadlocked on it in testing. NO KEY UPDATE still serialises every balance
// change, because it conflicts with itself, while leaving foreign-key checks
// free to proceed.

import { randomUUID } from "node:crypto";
import { Prisma, prisma } from "@cheqpay/db";
import { ApiError } from "../http";
import type { EffectiveLimits } from "./limits";
import type {
  AccountRow,
  Currency,
  DevTransactionRow,
  LedgerEntryRow,
  Mode,
  TransactionKind,
  TransactionStatus,
  WalletRow,
} from "./types";

export type Db = Prisma.TransactionClient | typeof prisma;

export const CURRENCIES: readonly Currency[] = ["NGN", "USD"];

/** A new sandbox account's starting balances: ₦1,000,000 and $1,000. */
export const SANDBOX_SEED: Record<Currency, bigint> = { NGN: 100_000_000n, USD: 100_000n };

/** The most a sandbox main wallet may hold after a top-up: ₦100,000,000 and $100,000. */
export const SANDBOX_MAX: Record<Currency, bigint> = { NGN: 10_000_000_000n, USD: 10_000_000n };

/** Create the account's main NGN and USD wallets for a mode, if missing. */
export async function ensureMainWallets(db: Db, accountId: string, mode: Mode): Promise<void> {
  for (const currency of CURRENCIES) {
    await db.$executeRawUnsafe(
      `INSERT INTO dev_wallets (id, account_id, mode, currency) VALUES ($1::uuid, $2::uuid, $3, $4)
       ON CONFLICT (account_id, mode, currency) WHERE customer_id IS NULL DO NOTHING`,
      randomUUID(),
      accountId,
      mode,
      currency,
    );
  }
}

export async function getMainWallet(db: Db, accountId: string, mode: Mode, currency: Currency): Promise<WalletRow | null> {
  const rows = await db.$queryRawUnsafe<WalletRow[]>(
    `SELECT * FROM dev_wallets WHERE account_id = $1::uuid AND mode = $2 AND currency = $3 AND customer_id IS NULL`,
    accountId,
    mode,
    currency,
  );
  return rows[0] ?? null;
}

/** A wallet, only if it belongs to this account and mode. */
export async function getWallet(db: Db, scope: { accountId: string; mode: Mode }, walletId: string): Promise<WalletRow | null> {
  const rows = await db.$queryRawUnsafe<WalletRow[]>(
    `SELECT * FROM dev_wallets WHERE id = $1::uuid AND account_id = $2::uuid AND mode = $3`,
    walletId,
    scope.accountId,
    scope.mode,
  );
  return rows[0] ?? null;
}

export interface NewTransaction {
  accountId: string;
  mode: Mode;
  kind: TransactionKind;
  status: TransactionStatus;
  currency: Currency;
  amountMinor: bigint;
  feeMinor?: bigint;
  walletId?: string | null;
  counterpartyWalletId?: string | null;
  customerId?: string | null;
  reference?: string | null;
  description?: string | null;
  metadata?: Record<string, unknown>;
  details?: Record<string, unknown>;
  providerRef?: string | null;
  appLedgerTxId?: string | null;
  initiatorIp?: string | null;
}

export async function insertTransaction(db: Db, t: NewTransaction): Promise<string> {
  const id = randomUUID();
  await db.$executeRawUnsafe(
    `INSERT INTO dev_transactions (id, account_id, mode, kind, status, currency, amount_minor, fee_minor,
       wallet_id, counterparty_wallet_id, customer_id, reference, description, metadata, details,
       provider_ref, app_ledger_tx_id, initiator_ip, completed_at)
     VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9::uuid, $10::uuid, $11::uuid, $12, $13, $14::jsonb, $15::jsonb,
       $16, $17::uuid, $18, CASE WHEN $5 IN ('successful', 'failed', 'reversed') THEN now() END)`,
    id,
    t.accountId,
    t.mode,
    t.kind,
    t.status,
    t.currency,
    t.amountMinor,
    t.feeMinor ?? 0n,
    t.walletId ?? null,
    t.counterpartyWalletId ?? null,
    t.customerId ?? null,
    t.reference ?? null,
    t.description ?? null,
    JSON.stringify(t.metadata ?? {}),
    JSON.stringify(t.details ?? {}),
    t.providerRef ?? null,
    t.appLedgerTxId ?? null,
    t.initiatorIp ?? null,
  );
  return id;
}

export async function getTransaction(db: Db, scope: { accountId: string; mode: Mode }, id: string): Promise<DevTransactionRow | null> {
  const rows = await db.$queryRawUnsafe<DevTransactionRow[]>(
    `SELECT * FROM dev_transactions WHERE id = $1::uuid AND account_id = $2::uuid AND mode = $3`,
    id,
    scope.accountId,
    scope.mode,
  );
  return rows[0] ?? null;
}

export interface Leg {
  walletId: string;
  /** Signed: negative takes money out of the wallet, positive puts it in. */
  amountMinor: bigint;
  /** What the entry records ("transfer_out", "fee", "refund", ...). */
  kind: string;
}

/**
 * Apply one transaction's balance changes. Must run inside a DB transaction
 * (prisma.$transaction), which the caller owns so the transaction row, these
 * entries and anything else it writes commit or fail together.
 *
 * Refuses: a wallet outside `scope` (404, so other accounts' ids look like
 * nothing), a debit from a frozen wallet, a currency other than `currency`,
 * and anything that would take a balance below zero. Credits still land on a
 * frozen wallet: money that has already arrived has to be recorded somewhere.
 */
export async function applyLegs(
  db: Prisma.TransactionClient,
  scope: { accountId: string; mode: Mode },
  transactionId: string,
  currency: Currency,
  legs: Leg[],
): Promise<Map<string, bigint>> {
  const ids = [...new Set(legs.map((l) => l.walletId))].sort();
  const locked = new Map<string, WalletRow>();
  for (const id of ids) {
    const rows = await db.$queryRawUnsafe<WalletRow[]>(`SELECT * FROM dev_wallets WHERE id = $1::uuid FOR NO KEY UPDATE`, id);
    const w = rows[0];
    if (!w || w.account_id !== scope.accountId || w.mode !== scope.mode) {
      throw new ApiError(404, "No such wallet", "not_found");
    }
    if (w.currency !== currency) {
      throw new ApiError(400, `That wallet holds ${w.currency}, not ${currency}.`, "currency_mismatch");
    }
    locked.set(id, w);
  }

  const after = new Map<string, bigint>();
  for (const leg of legs) {
    if (leg.amountMinor === 0n) continue;
    const w = locked.get(leg.walletId)!;
    if (leg.amountMinor < 0n && w.status === "frozen") {
      throw new ApiError(403, "This wallet is frozen. Money can't leave it.", "wallet_frozen");
    }
    const rows = await db.$queryRawUnsafe<{ available_minor: bigint }[]>(
      `UPDATE dev_wallets SET available_minor = available_minor + $2, updated_at = now()
        WHERE id = $1::uuid AND available_minor + $2 >= 0
        RETURNING available_minor`,
      leg.walletId,
      leg.amountMinor,
    );
    if (!rows[0]) {
      throw new ApiError(422, "The wallet does not hold enough for this.", "insufficient_funds");
    }
    await db.$executeRawUnsafe(
      `INSERT INTO dev_ledger_entries (wallet_id, transaction_id, kind, amount_minor, balance_after)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5)`,
      leg.walletId,
      transactionId,
      leg.kind,
      leg.amountMinor,
      rows[0].available_minor,
    );
    after.set(leg.walletId, rows[0].available_minor);
  }
  return after;
}

/** A wallet's statement, newest first, paged by entry id. */
export async function listEntries(walletId: string, opts: { limit: number; before?: bigint | null }): Promise<LedgerEntryRow[]> {
  return prisma.$queryRawUnsafe<LedgerEntryRow[]>(
    `SELECT * FROM dev_ledger_entries WHERE wallet_id = $1::uuid AND ($2::bigint IS NULL OR id < $2::bigint)
      ORDER BY id DESC LIMIT $3`,
    walletId,
    opts.before ?? null,
    opts.limit,
  );
}

/** Create the main wallets for test mode and credit the sandbox starting balances. */
export async function seedSandboxWallets(db: Prisma.TransactionClient, accountId: string): Promise<void> {
  await ensureMainWallets(db, accountId, "test");
  for (const currency of CURRENCIES) {
    const w = (await getMainWallet(db, accountId, "test", currency))!;
    const txId = await insertTransaction(db, {
      accountId,
      mode: "test",
      kind: "top_up",
      status: "successful",
      currency,
      amountMinor: SANDBOX_SEED[currency],
      walletId: w.id,
      description: "Sandbox starting balance",
    });
    await applyLegs(db, { accountId, mode: "test" }, txId, currency, [
      { walletId: w.id, amountMinor: SANDBOX_SEED[currency], kind: "top_up" },
    ]);
  }
}

/** Add simulated money to a sandbox main wallet, up to SANDBOX_MAX. */
export async function sandboxTopUp(accountId: string, currency: Currency, amountMinor: bigint): Promise<WalletRow> {
  const perTopUp = currency === "NGN" ? 1_000_000_000n : 1_000_000n; // ₦10,000,000 / $10,000
  if (amountMinor <= 0n || amountMinor > perTopUp) {
    throw new ApiError(400, `Top up between 0.01 and ${currency === "NGN" ? "₦10,000,000" : "$10,000"} at a time.`, "validation_error");
  }
  return prisma.$transaction(async (db) => {
    await ensureMainWallets(db, accountId, "test");
    const w = (await getMainWallet(db, accountId, "test", currency))!;
    if (w.available_minor + amountMinor > SANDBOX_MAX[currency]) {
      throw new ApiError(422, "That would take the sandbox wallet over its maximum.", "limit_exceeded");
    }
    const txId = await insertTransaction(db, {
      accountId,
      mode: "test",
      kind: "top_up",
      status: "successful",
      currency,
      amountMinor,
      walletId: w.id,
      description: "Sandbox top-up",
    });
    await applyLegs(db, { accountId, mode: "test" }, txId, currency, [{ walletId: w.id, amountMinor, kind: "top_up" }]);
    return (await getMainWallet(db, accountId, "test", currency))!;
  });
}

/** What every live wallet of an account holds, per currency (main plus customer wallets). */
export async function liveFloat(db: Db, accountId: string, currency: Currency): Promise<bigint> {
  const rows = await db.$queryRawUnsafe<{ total: bigint | null }[]>(
    `SELECT SUM(available_minor)::bigint AS total FROM dev_wallets WHERE account_id = $1::uuid AND mode = 'live' AND currency = $2`,
    accountId,
    currency,
  );
  return rows[0]?.total ?? 0n;
}

/** Kinds that count as money leaving the account, for the daily outflow limit. */
export const OUTFLOW_KINDS: readonly TransactionKind[] = ["bill_payment", "card_issue", "card_funding"];

/** The start of today in Lagos (UTC+1, no daylight saving), which is when daily limits reset. */
export function startOfLagosDay(now: Date = new Date()): Date {
  const hour = 3_600_000;
  const day = 24 * hour;
  return new Date(Math.floor((now.getTime() + hour) / day) * day - hour);
}

/**
 * Refuse a live outflow that would take today's total over the account's daily
 * limit, or a single payment over the per-transaction maximum. Takes an
 * advisory lock per account and currency so two payments racing from
 * different wallets can't both squeeze under the limit.
 */
export async function assertWithinOutflowLimits(
  db: Prisma.TransactionClient,
  account: AccountRow,
  currency: Currency,
  totalMinor: bigint,
  limits: EffectiveLimits,
  now: Date = new Date(),
): Promise<void> {
  if (totalMinor > limits.perTxnMax[currency]) {
    throw new ApiError(422, "That is over the largest single payment allowed on your account.", "limit_exceeded");
  }
  await db.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, `devout:${account.id}:${currency}`);
  const rows = await db.$queryRawUnsafe<{ total: bigint | null }[]>(
    `SELECT SUM(amount_minor + fee_minor)::bigint AS total FROM dev_transactions
      WHERE account_id = $1::uuid AND mode = 'live' AND currency = $2 AND kind = ANY($3::text[])
        AND status IN ('pending', 'successful') AND created_at >= $4`,
    account.id,
    currency,
    OUTFLOW_KINDS as unknown as string[],
    startOfLagosDay(now),
  );
  const spent = rows[0]?.total ?? 0n;
  if (spent + totalMinor > limits.dailyOut[currency]) {
    throw new ApiError(422, "That would take today's payments over your account's daily limit.", "limit_exceeded");
  }
}

export interface LedgerMismatch {
  wallet_id: string;
  account_id: string;
  mode: Mode;
  currency: Currency;
  available_minor: bigint;
  ledger_sum: bigint;
  last_balance_after: bigint | null;
}

/**
 * Wallets whose balance disagrees with their entries. One statement, so it
 * reads one consistent snapshot even while payments are running.
 */
export async function findLedgerMismatches(): Promise<LedgerMismatch[]> {
  return prisma.$queryRawUnsafe<LedgerMismatch[]>(
    `SELECT w.id AS wallet_id, w.account_id, w.mode, w.currency, w.available_minor,
            COALESCE(s.total, 0)::bigint AS ledger_sum, l.balance_after AS last_balance_after
       FROM dev_wallets w
       LEFT JOIN (SELECT wallet_id, SUM(amount_minor) AS total FROM dev_ledger_entries GROUP BY wallet_id) s
         ON s.wallet_id = w.id
       LEFT JOIN LATERAL (
         SELECT balance_after FROM dev_ledger_entries e WHERE e.wallet_id = w.id ORDER BY e.id DESC LIMIT 1
       ) l ON true
      WHERE w.available_minor <> COALESCE(s.total, 0)
         OR (l.balance_after IS NOT NULL AND l.balance_after <> w.available_minor)`,
  );
}

/** Freeze wallets whose balance can't be proven. Returns how many were frozen now. */
export async function freezeMismatchedWallets(mismatches: LedgerMismatch[]): Promise<number> {
  let frozen = 0;
  for (const m of mismatches) {
    const n = await prisma.$executeRawUnsafe(
      `UPDATE dev_wallets SET status = 'frozen', frozen_reason = 'reconciliation_mismatch', updated_at = now()
        WHERE id = $1::uuid AND status <> 'frozen'`,
      m.wallet_id,
    );
    frozen += n;
  }
  return frozen;
}

/** Live developer money per currency, for the treasury check against provider balances. */
export async function liveTotals(): Promise<Record<Currency, bigint>> {
  const rows = await prisma.$queryRawUnsafe<{ currency: Currency; total: bigint | null }[]>(
    `SELECT currency, SUM(available_minor)::bigint AS total FROM dev_wallets WHERE mode = 'live' GROUP BY currency`,
  );
  const out: Record<Currency, bigint> = { NGN: 0n, USD: 0n };
  for (const r of rows) out[r.currency] = r.total ?? 0n;
  return out;
}
