// apps/api/src/lib/billReconcile.ts
//
// Recovering bills that never settled.
//
// Bills settle on a bill.* webhook. When one never arrives, the purchase sits
// PROCESSING forever: the customer is debited and neither they nor support can
// tell whether the airtime landed. This checks a stuck bill against Maplerad's
// own purchase history and settles it from what the provider actually recorded.
//
// The safety rule, and the reason this cannot simply "resolve" every stuck bill:
// being listed in the provider's history PROVES the purchase happened, but its
// absence proves nothing — the list may be recent-only or paginated. So a match
// completes the bill, and no match leaves it exactly as it was. Refunding on
// absence could hand back money for airtime the customer already received.

import { TransactionStatus, TransactionType, prisma } from "@cheqpay/db";
import { getAirtimeHistory } from "./maplerad/airtimeHistory";
import { settleBillByProviderRef } from "./billSettlement";

export interface StuckBill {
  transactionId: string;
  service: string | null;
  billerName: string | null;
  customer: string | null;
  /** Gross amount in minor units, as a string for JSON safety. */
  amountMinor: string;
  providerRef: string | null;
  createdAt: string;
  /** True when Maplerad's purchase history confirms this one went through. */
  confirmedByProvider: boolean;
  /** Why it cannot be settled from here (when it cannot). */
  reason?: string;
}

export interface BillReconcileResult {
  ok: true;
  items: StuckBill[];
  summary: { total: number; confirmed: number; settled?: number };
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
    select: {
      id: true,
      amount: true,
      externalRef: true,
      metadata: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * List a user's stuck bills and say which the provider can confirm. Settles
 * nothing.
 */
export async function previewStuckBills(userId: string): Promise<BillReconcileResult> {
  const rows = await stuckBillsFor(userId);
  if (rows.length === 0) return { ok: true, items: [], summary: { total: 0, confirmed: 0 } };

  // One call covers every row; the history is business-wide.
  const history = await getAirtimeHistory();
  const seen = new Set(history.map((h) => h.id));

  const items: StuckBill[] = rows.map((r) => {
    const service = readMeta(r.metadata, "service");
    const ref = r.externalRef ?? readMeta(r.metadata, "providerRef");
    const confirmed = !!ref && seen.has(ref);

    let reason: string | undefined;
    if (!ref) {
      // Never accepted by the provider — there is no purchase to confirm.
      reason = "no provider reference: the purchase was never accepted";
    } else if (!confirmed) {
      reason =
        service === "airtime"
          ? "not in the provider's airtime history"
          : `cannot verify a ${service ?? "non-airtime"} bill here — only airtime history is available`;
    }

    return {
      transactionId: r.id,
      service,
      billerName: readMeta(r.metadata, "billerName"),
      customer: readMeta(r.metadata, "customer"),
      amountMinor: r.amount.toString(),
      providerRef: ref,
      createdAt: r.createdAt.toISOString(),
      confirmedByProvider: confirmed,
      reason,
    };
  });

  return {
    ok: true,
    items,
    summary: { total: items.length, confirmed: items.filter((i) => i.confirmedByProvider).length },
  };
}

/**
 * Settle the stuck bills the provider confirms.
 *
 * `ids` names the ledger rows to settle; omit it to settle every confirmed one.
 * Only ever settles as SUCCESSFUL, and only for a row the history confirms —
 * settlement itself runs through the same guarded path the webhook uses, so a
 * webhook arriving mid-way cannot double-settle.
 */
export async function settleStuckBills(
  userId: string,
  ids?: string[],
): Promise<BillReconcileResult> {
  const preview = await previewStuckBills(userId);
  const wanted = new Set(ids ?? []);
  const targets = preview.items.filter(
    (i) => i.confirmedByProvider && (ids === undefined || wanted.has(i.transactionId)),
  );

  let settled = 0;
  for (const item of targets) {
    if (!item.providerRef) continue;
    const res = await settleBillByProviderRef(item.providerRef, "successful");
    if (res.outcome === "completed") {
      settled += 1;
      item.confirmedByProvider = false;
      item.reason = "settled just now";
    } else if (res.outcome === "duplicate") {
      item.confirmedByProvider = false;
      item.reason = "already settled";
    }
  }

  return { ...preview, summary: { ...preview.summary, settled } };
}
