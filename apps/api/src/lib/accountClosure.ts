// apps/api/src/lib/accountClosure.ts
//
// What stops an account from closing. Closing never moves money, so anything
// of the user's that is not yet back in a wallet they can withdraw from would
// be stranded: a payout still in flight, a developer wallet, a gift card
// under review, an order not yet delivered, ad days not yet shown, an Ajo
// plan or group. Each check names what the user has to settle first.

import { Prisma, TransactionStatus, prisma } from "@cheqpay/db";
import { ajoCommitments } from "@/lib/ajo/lien";

/** "relation does not exist": a feature's tables aren't there yet, so nothing of it is owed. */
function isMissingTable(err: unknown): boolean {
  const e = err as { code?: string; meta?: { code?: string }; message?: string } | null;
  return e?.code === "42P01" || e?.meta?.code === "42P01" || /relation "[a-z_]+" does not exist/.test(String(e?.message ?? ""));
}

async function countOrZero(sql: Prisma.Sql): Promise<number> {
  try {
    const rows = await prisma.$queryRaw<{ n: number | bigint }[]>(sql);
    return Number(rows[0]?.n ?? 0);
  } catch (err) {
    if (isMissingTable(err)) return 0;
    throw err;
  }
}

/**
 * Reasons the account can't close yet, in the order the user should deal
 * with them. Empty means it may close.
 */
export async function closureBlockers(userId: string): Promise<{ code: string; message: string }[]> {
  const out: { code: string; message: string }[] = [];

  const [balances, inFlight, ajo, devWallets, giftCards, orders, adDays] = await Promise.all([
    prisma.balance.findMany({ where: { userId }, select: { available: true, locked: true } }),
    prisma.transaction.count({
      where: { userId, status: { in: [TransactionStatus.PENDING, TransactionStatus.PROCESSING] } },
    }),
    ajoCommitments(userId),
    countOrZero(Prisma.sql`
      SELECT count(*) AS n FROM dev_wallets w JOIN dev_accounts a ON a.id = w.account_id
      WHERE a.owner_user_id = ${userId}::uuid AND w.mode = 'live' AND w.available_minor > 0`),
    countOrZero(Prisma.sql`
      SELECT count(*) AS n FROM gift_card_trades WHERE user_id = ${userId}::uuid AND status IN ('SUBMITTED', 'IN_REVIEW')`),
    prisma.gadgetOrder.count({ where: { userId, status: { in: ["PAID", "PROCESSING", "SHIPPED"] } } }).catch((err) => {
      if (isMissingTable(err)) return 0;
      throw err;
    }),
    countOrZero(Prisma.sql`
      SELECT count(*) AS n FROM ad_campaign_slots s JOIN ad_campaigns c ON c.id = s.campaign_id
      WHERE c.user_id = ${userId}::uuid AND s.status = 'BOOKED'`),
  ]);

  if (ajo.owedKobo > 0n) {
    out.push({ code: "ajo_active", message: "Settle what you owe your Ajo group before deleting your account." });
  } else if (ajo.savedKobo > 0n || ajo.activePlans > 0 || ajo.openGroups > 0) {
    out.push({ code: "ajo_active", message: "End your Ajo plans and finish or leave your Ajo groups before deleting your account." });
  }
  if (balances.some((b) => b.available > 0n || b.locked > 0n)) {
    out.push({ code: "nonzero_balance", message: "Withdraw your remaining balance before deleting your account." });
  }
  if (inFlight > 0) {
    out.push({ code: "pending_transactions", message: "Wait for your pending transactions to finish before deleting your account." });
  }
  if (devWallets > 0) {
    out.push({ code: "developer_wallet", message: "Move the money out of your developer wallets before deleting your account." });
  }
  if (giftCards > 0) {
    out.push({ code: "gift_card_review", message: "A gift card you sold is still being reviewed. Wait for it to be paid or rejected first." });
  }
  if (orders > 0) {
    out.push({ code: "open_orders", message: "You have a gadget order that hasn't been delivered yet. Wait for it, or cancel it, first." });
  }
  if (adDays > 0) {
    out.push({ code: "live_ads", message: "Cancel your ad campaigns first, so the days not yet shown are refunded to you." });
  }
  return out;
}
