// apps/api/src/lib/devapi/deposits.ts
//
// Money arriving in a developer customer's virtual account.
//
// Live: the partner's collection webhook is verified (signature, then the
// transaction is re-fetched with verifyTransaction for its real amount,
// currency and destination) by lib/maplerad/settle.ts, which tries app users
// first. Only a deposit that matches no app account falls through to here, so
// app deposits behave exactly as before. A daily job also re-reads each live
// virtual account's history, in case a webhook never arrived.
//
// Either way the credit is exactly once per partner transaction (a unique
// index on the transaction's provider reference), lands in the customer's NGN
// wallet less the plan's deposit fee, and records deposit.received in the same
// database transaction. Money that has arrived is always credited, even to a
// frozen wallet or account: it's the customer's, and holding it in the wallet
// (where it can't leave) is the safe place for it.

import { randomUUID } from "node:crypto";
import { prisma, type Prisma } from "@cheqpay/db";
import { toPublicId } from "@cheqpay/devapi";
import type { CreditResult } from "../maplerad/deposits";
import type { VerifiedTransaction } from "../maplerad/transactions";
import { getCustomerTransactions } from "../maplerad/transactions";
import { alertOpsOnce } from "../opsAlert";
import { V1Error, currentPlan } from "./handler";
import { ensureDevApiSchema } from "./ensureDevApi";
import { applyLegs, getTransaction } from "./ledger";
import { getPlans } from "./plans";
import { getSubscription } from "./billing";
import { recordEvent } from "./events";
import { deliverSoon } from "./webhooks";
import { findLiveVirtualAccount, getVirtualAccount } from "./virtualAccounts";
import { transactionObject } from "./serialize";
import type { DevPlan } from "./plans";
import type { DevTransactionRow, Mode, VirtualAccountRow } from "./types";

const MONEY_TX = { maxWait: 10_000, timeout: 15_000 };

/** A single deposit at or above this (₦5,000,000) is flagged to ops. */
export const LARGE_DEPOSIT_MINOR = 500_000_000n;

/** The plan's deposit fee on an amount: basis points, capped, never more than the amount itself. */
export function depositFee(plan: Pick<DevPlan, "depositFeeBps" | "depositFeeCapMinor">, amountMinor: bigint): bigint {
  let fee = (amountMinor * BigInt(plan.depositFeeBps)) / 10_000n;
  if (plan.depositFeeCapMinor > 0 && fee > BigInt(plan.depositFeeCapMinor)) fee = BigInt(plan.depositFeeCapMinor);
  if (fee < 0n) return 0n;
  return fee > amountMinor ? amountMinor : fee;
}

/** Fees follow the account's plan; a live account between plans pays Starter's. */
async function planFor(accountId: string, mode: Mode): Promise<DevPlan> {
  const [plans, sub] = await Promise.all([getPlans(), getSubscription(accountId)]);
  const plan = currentPlan(sub, plans);
  return mode === "live" && !plan.live ? plans.starter : plan;
}

export interface Payer {
  name?: string | null;
  account_number?: string | null;
  bank_name?: string | null;
}

/** Credit one deposit to the virtual account's wallet. Safe to call again for the same provider reference. */
export async function creditDeposit(input: {
  va: VirtualAccountRow;
  providerRef: string;
  amountMinor: bigint;
  payer: Payer;
  /** Runs inside the credit's database transaction (the test helper records its idempotency key here). */
  within?: (db: Prisma.TransactionClient, transactionId: string) => Promise<void>;
}): Promise<{ outcome: "credited" | "duplicate"; transaction: DevTransactionRow | null }> {
  const { va, amountMinor } = input;
  if (amountMinor <= 0n) throw new Error("deposit amount must be positive");
  const plan = await planFor(va.account_id, va.mode);
  const fee = depositFee(plan, amountMinor);
  const scope = { accountId: va.account_id, mode: va.mode };
  const payerName = input.payer.name?.trim().slice(0, 120) || null;
  const details = {
    virtual_account_id: toPublicId("virtual_account", va.id),
    payer: {
      name: payerName,
      bank_name: input.payer.bank_name?.trim().slice(0, 80) || null,
      account_number_last4: input.payer.account_number ? input.payer.account_number.replace(/\D/g, "").slice(-4) || null : null,
    },
  };

  let eventId: string | null = null;
  const result = await prisma.$transaction(async (db) => {
    const id = randomUUID();
    const inserted = await db.$queryRawUnsafe<{ id: string }[]>(
      `INSERT INTO dev_transactions (id, account_id, mode, kind, status, currency, amount_minor, fee_minor,
         wallet_id, customer_id, description, details, provider_ref, completed_at)
       VALUES ($1::uuid, $2::uuid, $3, 'deposit', 'successful', 'NGN', $4, $5, $6::uuid, $7::uuid, $8, $9::jsonb, $10, now())
       ON CONFLICT (provider_ref) WHERE kind = 'deposit' DO NOTHING
       RETURNING id`,
      id,
      va.account_id,
      va.mode,
      amountMinor,
      fee,
      va.wallet_id,
      va.customer_id,
      payerName ? `Bank transfer from ${payerName}` : "Bank transfer",
      JSON.stringify(details),
      input.providerRef,
    );
    if (!inserted.length) return { outcome: "duplicate" as const, transaction: null };
    // One entry for what the wallet actually gains. The gross amount and the
    // fee are on the transaction; a separate fee debit could be refused by a
    // frozen wallet, and money that has arrived must always be recorded.
    const net = amountMinor - fee;
    if (net > 0n) await applyLegs(db, scope, id, "NGN", [{ walletId: va.wallet_id, amountMinor: net, kind: "deposit" }]);
    if (input.within) await input.within(db, id);
    const tx = (await getTransaction(db, scope, id))!;
    eventId = await recordEvent(db, { accountId: va.account_id, mode: va.mode, type: "deposit.received", object: transactionObject(tx) });
    return { outcome: "credited" as const, transaction: tx };
  }, MONEY_TX);

  if (eventId) deliverSoon([eventId]);
  if (result.outcome === "credited" && va.mode === "live" && amountMinor >= LARGE_DEPOSIT_MINOR) {
    void alertOpsOnce(
      `devapi-large-deposit:${input.providerRef}`,
      `💰 Developer API: a deposit of ₦${(Number(amountMinor) / 100).toLocaleString("en-US")} landed in a developer customer's virtual account. Review against AML thresholds.`,
      { developer_account: va.account_id, customer: toPublicId("customer", va.customer_id) },
    );
  }
  return result;
}

/**
 * The fall-through from the collection webhook: credit a verified deposit to a
 * developer customer's virtual account, or return null when it isn't one.
 */
export async function settleDevCollection(tx: VerifiedTransaction): Promise<CreditResult | null> {
  await ensureDevApiSchema();
  if ((tx.currency ?? "").toUpperCase() !== "NGN") return null;
  const va = await findLiveVirtualAccount({ providerAccountId: tx.account_id ?? null, providerCustomerId: tx.customer?.id ?? null });
  if (!va) return null;
  const r = await creditDeposit({
    va,
    providerRef: tx.id,
    amountMinor: BigInt(tx.amount),
    payer: { name: tx.source?.account_name, account_number: tx.source?.account_number, bank_name: tx.source?.bank_name },
  });
  return { outcome: r.outcome, amount: tx.amount, reason: "developer virtual account" };
}

/** Sandbox: pretend a bank transfer arrived. */
export async function simulateDeposit(
  scope: { accountId: string; mode: Mode },
  virtualAccountId: string,
  amountMinor: bigint,
  payer: Payer,
  within?: (db: Prisma.TransactionClient, transactionId: string) => Promise<void>,
): Promise<DevTransactionRow> {
  const va = await getVirtualAccount(scope, virtualAccountId);
  if (!va || va.mode !== "test") throw new V1Error(404, "No such virtual account.", "not_found", "id");
  if (va.status !== "active") throw new V1Error(409, "That virtual account isn't open.", "validation_error", "id");
  if (amountMinor > 1_000_000_000n) {
    throw new V1Error(400, "A simulated deposit can be at most ₦10,000,000 (1000000000 kobo).", "validation_error", "amount");
  }
  const r = await creditDeposit({
    va,
    providerRef: `test_${randomUUID()}`,
    amountMinor,
    payer: { name: payer.name ?? "Test Sender", bank_name: payer.bank_name ?? "CheqPay Test Bank", account_number: payer.account_number ?? "0123456789" },
    within,
  });
  return r.transaction!;
}

/**
 * The webhook backstop. Re-reads live virtual accounts' transaction history at
 * the partner (oldest-checked first, a bounded number per run) and settles any
 * deposit we never heard about, through the same verified, exactly-once path
 * the webhook uses.
 */
export async function reconcileLiveDeposits(limit: number): Promise<{ checked: number; credited: number }> {
  await ensureDevApiSchema();
  const accounts = await prisma.$queryRawUnsafe<{ id: string; provider_customer_id: string }[]>(
    `SELECT v.id, c.provider_customer_id FROM dev_virtual_accounts v JOIN dev_customers c ON c.id = v.customer_id
      WHERE v.mode = 'live' AND v.status = 'active' AND c.provider_customer_id IS NOT NULL
      ORDER BY v.deposits_checked_at NULLS FIRST LIMIT $1`,
    limit,
  );
  const { settleCollectionById } = await import("../maplerad/settle");
  let credited = 0;
  for (const a of accounts) {
    try {
      const { deposit } = await getCustomerTransactions(a.provider_customer_id);
      const ids = deposit.map((d) => d.transaction_id).filter(Boolean);
      if (ids.length) {
        const known = await prisma.$queryRawUnsafe<{ provider_ref: string }[]>(
          `SELECT provider_ref FROM dev_transactions WHERE kind = 'deposit' AND provider_ref = ANY($1::text[])`,
          ids,
        );
        const seen = new Set(known.map((k) => k.provider_ref));
        for (const id of ids.filter((x) => !seen.has(x))) {
          const r = await settleCollectionById(id).catch(() => null);
          if (r?.outcome === "credited") credited++;
        }
      }
      await prisma.$executeRawUnsafe(`UPDATE dev_virtual_accounts SET deposits_checked_at = now() WHERE id = $1::uuid`, a.id);
    } catch (err) {
      console.error("[devapi] deposit reconciliation skipped an account", { virtual_account: a.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  if (credited > 0) {
    await alertOpsOnce("devapi-missed-deposits", `⚠️ Developer API: the daily check credited ${credited} deposit(s) whose webhook never arrived.`);
  }
  return { checked: accounts.length, credited };
}
