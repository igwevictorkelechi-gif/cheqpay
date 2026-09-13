// apps/api/src/lib/billReconcile.ts
//
// Recovering bills that never settled.
//
// Bills settle on a bill.* webhook. When one never arrives, the purchase sits
// PROCESSING forever: the customer is debited and neither they nor support can
// tell whether the airtime landed. This asks the provider what actually became
// of each stuck bill and settles it from that answer.
//
// It verifies each bill BY ITS OWN TRANSACTION ID rather than scanning a
// purchase-history list. The list was the first approach and was a bad one: it
// only covered airtime, said nothing about a bill's status (presence was the
// only signal, so a genuine failure could never be refunded), and it is a
// single point of failure — GET /bills/airtime began returning HTTP 500 and
// took the whole feature with it. Verifying one id is narrower, definitive,
// works for every bill type, and cannot be broken by an unrelated bill.

import { TransactionStatus, TransactionType, prisma } from "@cheqpay/db";
import { verifyTransaction } from "./maplerad/transactions";
import { describeProviderError } from "./mapleradCustomer";
import { billOutcomeFrom, settleBillByProviderRef, type BillOutcome } from "./billSettlement";

export interface StuckBill {
  transactionId: string;
  service: string | null;
  billerName: string | null;
  customer: string | null;
  /** Gross amount in minor units, as a string for JSON safety. */
  amountMinor: string;
  providerRef: string | null;
  createdAt: string;
  /** What the provider says became of it: SUCCESS / FAILED / still pending. */
  providerStatus: string | null;
  /** How it would be settled: completed, or failed-and-refunded. Null if not yet. */
  resolution: "complete" | "refund" | null;
  /** Why it cannot be settled from here (when it cannot). */
  reason?: string;
}

export interface BillReconcileResult {
  ok: true;
  items: StuckBill[];
  summary: { total: number; resolvable: number; settled?: number };
}

function readMeta(metadata: unknown, key: string): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const v = (metadata as Record<string, unknown>)[key];
  return typeof v === "string" && v ? v : null;
}

/** Every bill of this user's that is still awaiting an outcome. */
async function stuckBillsFor(userId: string) {
  return prisma.transaction.findMany({
    where: {
      userId,
      type: TransactionType.BILL,
      status: TransactionStatus.PROCESSING,
    },
    select: { id: true, amount: true, externalRef: true, metadata: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
}

/** Ask the provider what became of one bill. Never throws. */
async function checkOne(row: {
  id: string;
  amount: bigint;
  externalRef: string | null;
  metadata: unknown;
  createdAt: Date;
}): Promise<StuckBill> {
  const ref = row.externalRef ?? readMeta(row.metadata, "providerRef");
  const base: StuckBill = {
    transactionId: row.id,
    service: readMeta(row.metadata, "service"),
    billerName: readMeta(row.metadata, "billerName"),
    customer: readMeta(row.metadata, "customer"),
    amountMinor: row.amount.toString(),
    providerRef: ref,
    createdAt: row.createdAt.toISOString(),
    providerStatus: null,
    resolution: null,
  };

  if (!ref) {
    // Never accepted by the provider — there is no transaction to ask about.
    return { ...base, reason: "no provider reference: the purchase was never accepted" };
  }

  let outcome: BillOutcome;
  let status: string | undefined;
  try {
    const tx = await verifyTransaction(ref);
    status = tx.status;
    outcome = billOutcomeFrom("", tx.status);
  } catch (err) {
    // One bill the provider cannot answer for must not hide the others.
    return { ...base, reason: describeProviderError(err) };
  }

  if (outcome === "pending") {
    return { ...base, providerStatus: status ?? null, reason: "the provider still reports it pending" };
  }
  return {
    ...base,
    providerStatus: status ?? null,
    resolution: outcome === "successful" ? "complete" : "refund",
  };
}

function summarise(items: StuckBill[], settled?: number): BillReconcileResult["summary"] {
  return {
    total: items.length,
    resolvable: items.filter((i) => i.resolution !== null).length,
    ...(settled === undefined ? {} : { settled }),
  };
}

/**
 * List a user's stuck bills and what the provider says became of each. Settles
 * nothing.
 */
export async function previewStuckBills(userId: string): Promise<BillReconcileResult> {
  const rows = await stuckBillsFor(userId);
  const items = await Promise.all(rows.map(checkOne));
  return { ok: true, items, summary: summarise(items) };
}

/**
 * Settle the stuck bills the provider can answer for.
 *
 * `ids` names the ledger rows to settle; omit it to settle every resolvable
 * one. A bill the provider reports SUCCESS is completed; one it reports FAILED
 * is refunded — the amount AND the margin. A bill it still calls pending is
 * left exactly as it is, because "no answer yet" is not an outcome.
 *
 * Settlement runs through the same guarded path the webhook uses, so a webhook
 * arriving mid-way cannot double-settle.
 */
export async function settleStuckBills(
  userId: string,
  ids?: string[],
): Promise<BillReconcileResult> {
  const preview = await previewStuckBills(userId);
  const wanted = new Set(ids ?? []);
  const targets = preview.items.filter(
    (i) => i.resolution !== null && (ids === undefined || wanted.has(i.transactionId)),
  );

  let settled = 0;
  for (const item of targets) {
    if (!item.providerRef) continue;
    const res = await settleBillByProviderRef(
      item.providerRef,
      item.resolution === "complete" ? "successful" : "failed",
    );
    if (res.outcome === "completed" || res.outcome === "refunded") {
      settled += 1;
      item.resolution = null;
      item.reason = res.outcome === "completed" ? "settled just now" : "refunded just now";
    } else if (res.outcome === "duplicate") {
      item.resolution = null;
      item.reason = "already settled";
    }
  }

  return { ...preview, summary: summarise(preview.items, settled) };
}
