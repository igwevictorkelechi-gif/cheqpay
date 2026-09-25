import {
  Asset,
  Network,
  TransactionStatus,
  TransactionType,
  UserStatus,
  prisma,
} from "@cheqpay/db";
import { isDefiniteRejection } from "@/lib/providerErrors";
import { requireAdmin } from "@/lib/auth";
import { recordAdminAction, requireAdminActor, requireAdminOtp } from "@/lib/adminGuard";
import { isPlausibleTxHash } from "@/lib/txHashFormat";
import { getCustodyProvider } from "@/custody";
import { getPaymentProvider } from "@/payments";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { fromMinorUnits } from "@/lib/money";
import { reviewActionSchema } from "@/lib/validation";
import { isManualAsset } from "@/lib/manualCrypto";
import { notifyUser } from "@/lib/alerts";

export const dynamic = "force-dynamic";

/** Admin: list withdrawals held for AML review. */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    const held = await prisma.transaction.findMany({
      where: { type: TransactionType.WITHDRAWAL, status: TransactionStatus.PENDING },
      orderBy: { createdAt: "asc" },
      include: { user: { select: { email: true } } },
      take: 100,
    });
    return jsonOk({
      withdrawals: held.map((w) => ({
        id: w.id,
        userId: w.userId,
        email: w.user.email,
        asset: w.asset,
        network: w.network,
        amount: w.amount.toString(),
        amountFormatted: fromMinorUnits(w.amount, w.asset),
        metadata: w.metadata,
        createdAt: w.createdAt,
      })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * How long money an admin created stays unwithdrawable. The 22 Sep payout was
 * of funds credited from nothing twenty minutes earlier.
 */
const ADMIN_CREDIT_HOLD_DAYS = 7;

/**
 * Admin: approve (release/broadcast) or reject (refund) a held withdrawal.
 *
 * Rejecting only ever returns money to the user, so it needs nothing extra.
 * Approving releases money for good, so it needs:
 *  - a named admin and a fresh authenticator code;
 *  - an ACTIVE, identity-verified account;
 *  - for a manually-paid asset, the real on-chain hash of the payout — the
 *    approval records that someone paid it, so it must say which transfer;
 *  - no admin-created balance of that asset in the last 7 days. Money an admin
 *    conjured cannot leave the platform on the same admin's say-so. That is the
 *    exact sequence of 22 Sep: credit 10,000 USDT, then approve its withdrawal.
 */
export async function POST(req: Request) {
  try {
    const actor = await requireAdminActor(req);
    const { transactionId, action, txHash } = reviewActionSchema.parse(await req.json());

    const tx = await prisma.transaction.findUnique({ where: { id: transactionId } });
    if (!tx || tx.type !== TransactionType.WITHDRAWAL) {
      throw new ApiError(404, "Withdrawal not found", "not_found");
    }
    if (tx.status !== TransactionStatus.PENDING) {
      throw new ApiError(409, `Withdrawal is not pending review (${tx.status})`, "not_pending");
    }

    const meta = (tx.metadata ?? {}) as {
      toAddress?: string;
      bankCode?: string;
      accountNumber?: string;
    };

    if (action === "reject") {
      // Claim the row first: two admins (or two tabs) acting at once must not
      // both refund, or refund one that the other just approved.
      await prisma.$transaction(async (db) => {
        const claimed = await db.transaction.updateMany({
          where: { id: tx.id, status: TransactionStatus.PENDING },
          data: { status: TransactionStatus.REVERSED },
        });
        if (claimed.count !== 1) {
          throw new ApiError(409, "Someone else already handled this withdrawal", "not_pending");
        }
        await db.balance.update({
          where: { userId_asset: { userId: tx.userId, asset: tx.asset } },
          // Refund the full debit, including any withheld fee.
          data: { available: { increment: tx.amount + tx.fee } },
        });
        await db.auditLog.create({
          data: {
            userId: tx.userId,
            action: "withdrawal.review.rejected",
            resourceType: "Transaction",
            resourceId: tx.id,
            details: { asset: tx.asset, amount: tx.amount.toString() },
          },
        });
      });
      const owner = await prisma.user.findUnique({ where: { id: tx.userId }, select: { email: true } });
      await recordAdminAction(req, actor, {
        action: "admin.withdrawal.rejected",
        summary: `Rejected ${fromMinorUnits(tx.amount, tx.asset)} ${tx.asset} withdrawal for ${owner?.email ?? tx.userId} (refunded)`,
        userId: tx.userId,
        resourceType: "Transaction",
        resourceId: tx.id,
      });
      return jsonOk({ transactionId: tx.id, status: "reversed" });
    }

    // approve — guarded.
    await requireAdminOtp(req);

    const owner = await prisma.user.findUnique({
      where: { id: tx.userId },
      select: { email: true, status: true, kycTier: true },
    });
    if (!owner || owner.status !== UserStatus.ACTIVE) {
      throw new ApiError(422, `This account is ${owner?.status.toLowerCase() ?? "missing"} — reject the withdrawal instead.`, "account_not_active");
    }
    if (owner.kycTier < 1) {
      throw new ApiError(422, "This account hasn't verified its identity — reject the withdrawal instead.", "account_unverified");
    }

    const since = new Date(Date.now() - ADMIN_CREDIT_HOLD_DAYS * 24 * 60 * 60 * 1000);
    const adminCredited = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*)::bigint AS n FROM ledger_transactions
        WHERE user_id = $1::uuid AND asset::text = $2 AND created_at > $3
          AND status::text <> 'REVERSED'
          AND metadata->>'kind' = 'admin_adjustment' AND metadata->>'direction' = 'credit'`,
      tx.userId,
      tx.asset,
      since,
    );
    if ((adminCredited[0]?.n ?? 0n) > 0n) {
      throw new ApiError(
        422,
        `This account received an admin credit of ${tx.asset} in the last ${ADMIN_CREDIT_HOLD_DAYS} days, ` +
          "so its withdrawal can't be approved yet. If the credit was a mistake, reverse it and reject this withdrawal.",
        "admin_credit_hold",
      );
    }

    if (await isManualAsset(tx.asset)) {
      if (!txHash || !isPlausibleTxHash(tx.network, txHash)) {
        throw new ApiError(
          422,
          "Pay this withdrawal from the business wallet first, then paste the real transaction hash to approve it.",
          "tx_hash_required",
        );
      }
    }

    // Claim the row before any money moves: only one approval can win, and
    // an approval can't race a rejection. From here the row is PROCESSING, so
    // a failure below can never leave it approvable a second time.
    const claimed = await prisma.transaction.updateMany({
      where: { id: tx.id, status: TransactionStatus.PENDING },
      data: { status: TransactionStatus.PROCESSING },
    });
    if (claimed.count !== 1) {
      throw new ApiError(409, "Someone else already handled this withdrawal", "not_pending");
    }

    // Release the reserved funds to the destination.
    const amount = fromMinorUnits(tx.amount, tx.asset);
    try {
      if (tx.asset === Asset.NGN) {
        const psp = getPaymentProvider();
        const transfer = await psp.initiateTransfer({
          amount,
          bankCode: meta.bankCode ?? "",
          accountNumber: meta.accountNumber ?? "",
          reference: tx.id,
        });
        await prisma.transaction.update({
          where: { id: tx.id },
          data: { status: TransactionStatus.PROCESSING, externalRef: transfer.providerRef },
        });
      } else if (await isManualAsset(tx.asset)) {
        // Manual custody: the admin has already sent the funds from the
        // business wallet — approving records completion (+ on-chain hash).
        await prisma.transaction.update({
          where: { id: tx.id },
          data: {
            status: TransactionStatus.COMPLETED,
            ...(txHash ? { txHash, externalRef: txHash } : {}),
          },
        });
        await notifyUser(tx.userId, {
          category: "withdrawals",
          title: "Crypto withdrawal sent",
          body: `Your ${amount} ${tx.asset} withdrawal has been sent.`,
          data: { transactionId: tx.id, ...(txHash ? { txHash } : {}) },
        });
      } else {
        const custody = getCustodyProvider();
        const result = await custody.createWithdrawal({
          userId: tx.userId,
          asset: tx.asset,
          network: (tx.network ?? Network.BITCOIN) as Network,
          toAddress: meta.toAddress ?? "",
          amount,
        });
        await prisma.transaction.update({
          where: { id: tx.id },
          data: {
            status: TransactionStatus.PROCESSING,
            txHash: result.txHash,
            externalRef: result.txHash,
          },
        });
      }
      await recordAdminAction(req, actor, {
        action: "withdrawal.review.approved",
        summary: `Approved ${amount} ${tx.asset} withdrawal for ${owner.email}`,
        userId: tx.userId,
        resourceType: "Transaction",
        resourceId: tx.id,
        details: { asset: tx.asset, amount: tx.amount.toString(), txHash: txHash ?? null },
      });
      return jsonOk({ transactionId: tx.id, status: "processing" });
    } catch (err) {
      if (err instanceof ApiError) throw err;
      if (isDefiniteRejection(err)) {
        // Refused outright — nothing was sent. Put it back for review.
        await prisma.transaction.updateMany({
          where: { id: tx.id, status: TransactionStatus.PROCESSING },
          data: { status: TransactionStatus.PENDING },
        });
        throw new ApiError(502, "The provider refused the payout; it's back in the review queue", "provider_failed");
      }
      // No clear answer — it may have been sent. Leave it PROCESSING so it
      // can't be approved again; the webhook or reconcile job settles it.
      throw new ApiError(
        502,
        "No clear answer from the provider. The withdrawal is held as processing — check it before acting again.",
        "provider_unknown",
      );
    }
  } catch (err) {
    return toErrorResponse(err);
  }
}
