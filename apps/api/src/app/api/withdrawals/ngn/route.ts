import { Asset, prisma } from "@cheqpay/db";
import { requireUser } from "@/lib/auth";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { fromMinorUnits, toMinorUnits } from "@/lib/money";
import { enforceRateLimit } from "@/lib/ratelimit";
import { ngnWithdrawalSchema } from "@/lib/validation";
import { getWithdrawalMinNgn } from "@/lib/settings";
import { requestContext } from "@/lib/requestContext";
import { readPin, requireTransactionPin } from "@/lib/transactionPin";
import { initiateNgnPayout } from "@/lib/ngnPayout";

import { assertFeatureEnabled } from "@/lib/features";

export const dynamic = "force-dynamic";

/**
 * Request an NGN bank payout. Flow (money-safe):
 *   1. validate + enforce tier single-tx and daily limits
 *   2. atomically debit available balance (refuses to overdraw) + record a
 *      PROCESSING withdrawal transaction
 *   3. initiate the PSP transfer; on PSP failure, refund and mark FAILED
 *   4. final state arrives via the transfer webhook (COMPLETED / REVERSED)
 * Steps 1-4 live in lib/ngnPayout.ts, shared with auto cash-out.
 */
export async function POST(req: Request) {
  try {
    // The address that initiated this payout, kept on the transaction so an
    // investigation can answer "where was this withdrawal requested from".
    const { ip: initiatorIp } = requestContext(req);
    const auth = await requireUser(req);
    await assertFeatureEnabled("ngn_withdrawals");
    await enforceRateLimit(`wd:ngn:${auth.id}`, 5, 60_000);

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

    // Idempotent replay — only ever of the caller's own request. A key that
    // happens to match someone else's transaction must not reveal it.
    const existing = await prisma.transaction.findUnique({
      where: { idempotencyKey },
    });
    if (existing) {
      if (existing.userId !== auth.id) {
        throw new ApiError(409, "Idempotency-Key already used", "idempotency_conflict");
      }
      return jsonOk({ transactionId: existing.id, status: existing.status });
    }

    // Authorise the payout. Placed AFTER the replay short-circuit so a client
    // retrying a payout that already went through still gets its answer, and
    // BEFORE the first write so a wrong PIN leaves no transaction behind and
    // does not burn the caller's idempotency key.
    await requireTransactionPin(auth.id, readPin(req));

    const out = await initiateNgnPayout({
      user: { id: auth.id, legalName: user.legalName, kycTier: user.kycTier },
      bankCode: body.bankCode,
      accountNumber: body.accountNumber,
      narration: body.narration,
      requestedMinor,
      feeInclusive: Boolean(body.feeInclusive),
      idempotencyKey,
      ip: initiatorIp,
    });
    return jsonOk(
      {
        transactionId: out.transactionId,
        status: "processing",
        amount: fromMinorUnits(out.totalMinor, Asset.NGN),
        fee: fromMinorUnits(out.feeMinor, Asset.NGN),
        youReceive: fromMinorUnits(out.amountMinor, Asset.NGN),
      },
      // An unclear provider answer is accepted, not done: held for reconcile.
      out.unclear ? 202 : 200
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
