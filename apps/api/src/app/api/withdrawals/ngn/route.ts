import { Asset, TransactionStatus, TransactionType, prisma } from "@cheqpay/db";
import { requireUser } from "@/lib/auth";
import { getPaymentProvider } from "@/payments";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { fromMinorUnits, toMinorUnits } from "@/lib/money";
import { assertWithdrawalAllowed, sumTodayWithdrawalsNgnKobo } from "@/lib/limits";
import { MAX_TIER } from "@/lib/kyc";
import { getEnv } from "@/lib/env";
import { enforceRateLimit } from "@/lib/ratelimit";
import { ngnWithdrawalSchema } from "@/lib/validation";
import { getWithdrawalFeeNgn, getWithdrawalMinNgn } from "@/lib/settings";
import { requestContext } from "@/lib/requestContext";
import { readPin, requireTransactionPin } from "@/lib/transactionPin";
import { withdrawalBreakdown } from "@/lib/fees";

import { assertFeatureEnabled } from "@/lib/features";

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
    // The address that initiated this payout, kept on the transaction so an
    // investigation can answer "where was this withdrawal requested from".
    const { ip: initiatorIp } = requestContext(req);
    const auth = await requireUser(req);
    await assertFeatureEnabled("ngn_withdrawals");
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
    // What the user typed. With feeInclusive this is what leaves their balance;
    // without it, it is what the bank receives. See ngnWithdrawalSchema.
    const requestedMinor = toMinorUnits(body.amount, Asset.NGN);

    // Floor on the payout, checked before anything is reserved. Every payout
    // costs the same provider fee whatever its size, so a tiny one can cost
    // more to send than it moves.
    const minNgn = await getWithdrawalMinNgn();
    if (minNgn > 0 && requestedMinor < toMinorUnits(String(minNgn), Asset.NGN)) {
      throw new ApiError(
        422,
        `The smallest withdrawal is ₦${minNgn.toLocaleString("en-NG")}`,
        "below_minimum",
      );
    }

    // Idempotent replay.
    const existing = await prisma.transaction.findUnique({
      where: { idempotencyKey },
    });
    if (existing) {
      return jsonOk({ transactionId: existing.id, status: existing.status });
    }

    // Authorise the payout. Placed AFTER the replay short-circuit so a client
    // retrying a payout that already went through still gets its answer, and
    // BEFORE the first write so a wrong PIN leaves no transaction behind and
    // does not burn the caller's idempotency key.
    await requireTransactionPin(auth.id, readPin(req));

    // Business withdrawal fee (admin-set flat NGN, default 0).
    //  - feeInclusive: the fee comes out of the typed amount. The balance drops by
    //    exactly what the user typed and the bank receives the rest, so "Max"
    //    (the whole balance) always works. See lib/fees.ts.
    //  - otherwise (older clients): the bank receives the typed amount and the fee
    //    is debited on top.
    // Either way the row records amount = what the bank receives and fee = fee,
    // so the refund and reversal paths (amount + fee) stay correct.
    const feeMinor = BigInt(Math.round((await getWithdrawalFeeNgn()) * 100));
    const { payoutMinor: amountMinor, grossMinor: totalMinor } = body.feeInclusive
      ? withdrawalBreakdown(requestedMinor, feeMinor)
      : { payoutMinor: requestedMinor, grossMinor: requestedMinor + feeMinor };

    const usedToday = await sumTodayWithdrawalsNgnKobo(auth.id);
    const effectiveTier = getEnv().RELAX_WITHDRAWAL_GUARDS ? MAX_TIER : user.kycTier;
    assertWithdrawalAllowed(effectiveTier, amountMinor, usedToday);

    // Atomic debit + record. Throws (rolls back) on insufficient funds.
    const tx = await prisma.$transaction(async (db) => {
      const debit = await db.balance.updateMany({
        where: { userId: auth.id, asset: Asset.NGN, available: { gte: totalMinor } },
        data: { available: { decrement: totalMinor } },
      });
      if (debit.count !== 1) {
        throw new ApiError(
          422,
          feeMinor > 0n && !body.feeInclusive
            ? "Insufficient NGN balance (amount + withdrawal fee)"
            : "Insufficient NGN balance",
          "insufficient_funds"
        );
      }
      return db.transaction.create({
        data: {
          userId: auth.id,
          type: TransactionType.WITHDRAWAL,
          asset: Asset.NGN,
          amount: amountMinor,
          fee: feeMinor,
          status: TransactionStatus.PROCESSING,
          idempotencyKey,
          metadata: {
            bankCode: body.bankCode,
            accountNumber: body.accountNumber,
            ip: initiatorIp,
          },
        },
      });
    });

    // Initiate the payout. The transfer reference is our transaction id so the
    // webhook can finalize it.
    try {
      const psp = getPaymentProvider();
      const transfer = await psp.initiateTransfer({
        // What the bank receives — the typed amount minus the fee when fee-inclusive.
        amount: fromMinorUnits(amountMinor, Asset.NGN),
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
          ipAddress: initiatorIp,
          action: "ngn.withdrawal.initiated",
          resourceType: "Transaction",
          resourceId: tx.id,
          details: { amountMinor: amountMinor.toString(), providerRef: transfer.providerRef },
        },
      });
      return jsonOk({
        transactionId: tx.id,
        status: "processing",
        amount: fromMinorUnits(totalMinor, Asset.NGN),
        fee: fromMinorUnits(feeMinor, Asset.NGN),
        youReceive: fromMinorUnits(amountMinor, Asset.NGN),
      });
    } catch {
      // PSP rejected the transfer — refund (amount + fee) and fail.
      await prisma.$transaction([
        prisma.balance.update({
          where: { userId_asset: { userId: auth.id, asset: Asset.NGN } },
          data: { available: { increment: totalMinor } },
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
