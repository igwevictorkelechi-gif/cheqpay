import { Asset, TransactionStatus, TransactionType, prisma } from "@cheqpay/db";
import { requireUser } from "@/lib/auth";
import { getPaymentProvider } from "@/payments";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { toMinorUnits } from "@/lib/money";
import { assertWithdrawalAllowed, sumTodayWithdrawalsNgnKobo } from "@/lib/limits";
import { enforceRateLimit } from "@/lib/ratelimit";
import { ngnWithdrawalSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

/**
 * Request an NGN bank payout. Flow (money-safe):
 *   1. validate + enforce tier single-tx and daily limits
 *   2. atomically debit available balance (refuses to overdraw) + record a
 *      PROCESSING withdrawal transaction
 *   3. initiate the PSP transfer; on PSP failure, refund and mark FAILED
 *   4. final state arrives via the transfer webhook (COMPLETED / REVERSED)
 */
export async function POST(req: Request) {
  try {
    const auth = await requireUser(req);
    enforceRateLimit(`wd:ngn:${auth.id}`, 5, 60_000);

    const idempotencyKey = req.headers.get("idempotency-key");
    if (!idempotencyKey) {
      throw new ApiError(400, "Missing Idempotency-Key header", "no_idempotency_key");
    }

    const user = await prisma.user.findUnique({ where: { id: auth.id } });
    if (!user) {
      throw new ApiError(404, "Profile not provisioned; POST /api/me first", "no_profile");
    }

    const body = ngnWithdrawalSchema.parse(await req.json());
    const amountMinor = toMinorUnits(body.amount, Asset.NGN);

    // Idempotent replay.
    const existing = await prisma.transaction.findUnique({
      where: { idempotencyKey },
    });
    if (existing) {
      return jsonOk({ transactionId: existing.id, status: existing.status });
    }

    const usedToday = await sumTodayWithdrawalsNgnKobo(auth.id);
    assertWithdrawalAllowed(user.kycTier, amountMinor, usedToday);

    // Atomic debit + record. Throws (rolls back) on insufficient funds.
    const tx = await prisma.$transaction(async (db) => {
      const debit = await db.balance.updateMany({
        where: { userId: auth.id, asset: Asset.NGN, available: { gte: amountMinor } },
        data: { available: { decrement: amountMinor } },
      });
      if (debit.count !== 1) {
        throw new ApiError(422, "Insufficient NGN balance", "insufficient_funds");
      }
      return db.transaction.create({
        data: {
          userId: auth.id,
          type: TransactionType.WITHDRAWAL,
          asset: Asset.NGN,
          amount: amountMinor,
          status: TransactionStatus.PROCESSING,
          idempotencyKey,
          metadata: {
            bankCode: body.bankCode,
            accountNumber: body.accountNumber,
          },
        },
      });
    });

    // Initiate the payout. The transfer reference is our transaction id so the
    // webhook can finalize it.
    try {
      const psp = getPaymentProvider();
      const transfer = await psp.initiateTransfer({
        amount: body.amount,
        bankCode: body.bankCode,
        accountNumber: body.accountNumber,
        reference: tx.id,
        narration: body.narration,
      });
      await prisma.transaction.update({
        where: { id: tx.id },
        data: { externalRef: transfer.providerRef },
      });
      await prisma.auditLog.create({
        data: {
          userId: auth.id,
          action: "ngn.withdrawal.initiated",
          resourceType: "Transaction",
          resourceId: tx.id,
          details: { amountMinor: amountMinor.toString(), providerRef: transfer.providerRef },
        },
      });
      return jsonOk({ transactionId: tx.id, status: "processing" });
    } catch {
      // PSP rejected the transfer — refund and fail the transaction.
      await prisma.$transaction([
        prisma.balance.update({
          where: { userId_asset: { userId: auth.id, asset: Asset.NGN } },
          data: { available: { increment: amountMinor } },
        }),
        prisma.transaction.update({
          where: { id: tx.id },
          data: { status: TransactionStatus.FAILED },
        }),
      ]);
      throw new ApiError(502, "Payout could not be initiated; funds refunded", "payout_failed");
    }
  } catch (err) {
    return toErrorResponse(err);
  }
}
