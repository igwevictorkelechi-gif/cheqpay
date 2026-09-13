// apps/api/src/lib/billSettlement.ts
//
// Settling a bill after the fact, from Maplerad's bill.* webhook.
//
// Bills are asynchronous: POST /bills/... returns an accepted transaction, and
// the real outcome arrives later as bill.successful / bill.failed. Without this
// every bill the provider merely ACCEPTED stayed PROCESSING in our ledger
// forever — the customer was debited, the airtime arrived, and the app still
// said "processing" — and a bill that later FAILED was never refunded at all,
// because only the synchronous error path gave money back.
//
// Matching is on the provider's transaction id, which we store as the ledger
// row's externalRef when the purchase is accepted. Idempotent by construction:
// every write is guarded on the row still being PROCESSING, so a repeated
// webhook settles nothing twice.

import { Asset, TransactionStatus, TransactionType, prisma } from "@cheqpay/db";
import { awardCashback } from "./cashback";
import { notifyUser } from "./alerts";
import { fromMinorUnits } from "./money";

export type BillOutcome = "successful" | "failed" | "pending";

export interface BillSettlementResult {
  outcome: "completed" | "refunded" | "duplicate" | "unmatched" | "ignored";
  transactionId?: string;
  reason?: string;
}

/** Read the outcome from the event name, falling back to the status field. */
export function billOutcomeFrom(event: string, status?: string): BillOutcome {
  const s = (status ?? "").toUpperCase();
  if (event.endsWith(".failed") || s === "FAILED" || s === "DECLINED") return "failed";
  if (event.endsWith(".successful") || s === "SUCCESS" || s === "SUCCESSFUL") {
    return "successful";
  }
  return "pending";
}

/**
 * Settle the bill this provider transaction id belongs to.
 *
 * A pending event is acknowledged and ignored — the row is already PROCESSING,
 * which is what pending means. An id we cannot place is reported rather than
 * guessed at: bills are the one flow where the provider id is always ours.
 */
export async function settleBillByProviderRef(
  providerRef: string,
  outcome: BillOutcome,
): Promise<BillSettlementResult> {
  if (!providerRef) return { outcome: "ignored", reason: "no provider reference" };
  if (outcome === "pending") return { outcome: "ignored", reason: "still pending" };

  const tx = await prisma.transaction.findFirst({
    where: { type: TransactionType.BILL, externalRef: providerRef },
    select: { id: true, userId: true, amount: true, fee: true, status: true, metadata: true },
  });
  if (!tx) return { outcome: "unmatched", reason: "no bill for this provider reference" };
  if (tx.status !== TransactionStatus.PROCESSING) {
    return { outcome: "duplicate", transactionId: tx.id };
  }

  const amountMinor = tx.amount;
  const feeMinor = tx.fee ?? 0n;

  if (outcome === "successful") {
    // Guarded on PROCESSING so two deliveries cannot both "win" and pay
    // cashback twice.
    const moved = await prisma.transaction.updateMany({
      where: { id: tx.id, status: TransactionStatus.PROCESSING },
      data: { status: TransactionStatus.COMPLETED },
    });
    if (moved.count !== 1) return { outcome: "duplicate", transactionId: tx.id };

    // Earned on the bill face value, not the margin-inclusive total — same
    // basis the synchronous path uses.
    await awardCashback({
      userId: tx.userId,
      source: "bill",
      baseNgnMinor: amountMinor,
      sourceTransactionId: tx.id,
    }).catch((err) => console.error("[bill settlement] cashback failed", err));

    const name = readMeta(tx.metadata, "billerName") ?? "Bill";
    await notifyUser(tx.userId, {
      category: "bills",
      title: "Bill paid",
      body: `${name} — ₦${fromMinorUnits(amountMinor, Asset.NGN)} went through.`,
      data: { transactionId: tx.id },
    }).catch(() => undefined);

    return { outcome: "completed", transactionId: tx.id };
  }

  // Failed: give back everything that was taken — the bill amount AND the
  // margin charged on top of it.
  const refundMinor = amountMinor + feeMinor;
  const settled = await prisma.$transaction(async (db) => {
    const moved = await db.transaction.updateMany({
      where: { id: tx.id, status: TransactionStatus.PROCESSING },
      data: { status: TransactionStatus.FAILED },
    });
    if (moved.count !== 1) return false;
    await db.balance.update({
      where: { userId_asset: { userId: tx.userId, asset: Asset.NGN } },
      data: { available: { increment: refundMinor } },
    });
    return true;
  });
  if (!settled) return { outcome: "duplicate", transactionId: tx.id };

  await notifyUser(tx.userId, {
    category: "bills",
    title: "Bill failed",
    body: `That payment did not go through. ₦${fromMinorUnits(
      refundMinor,
      Asset.NGN,
    )} has been returned to your balance.`,
    data: { transactionId: tx.id },
  }).catch(() => undefined);

  return { outcome: "refunded", transactionId: tx.id };
}

function readMeta(metadata: unknown, key: string): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const v = (metadata as Record<string, unknown>)[key];
  return typeof v === "string" && v ? v : null;
}
