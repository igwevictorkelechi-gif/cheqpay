import { requireUser } from "@/lib/auth";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { enforceRateLimit } from "@/lib/ratelimit";
import { requestContext } from "@/lib/requestContext";
import { readPin, requireTransactionPin } from "@/lib/transactionPin";
import { assertFeatureEnabled } from "@/lib/features";
import { executeBillPayment } from "@/lib/billPay";

export const dynamic = "force-dynamic";

/**
 * Pay a bill from the user's NGN balance, authorised by their transaction PIN.
 * The money movement itself lives in lib/billPay (shared with autopay).
 */
export async function POST(req: Request) {
  try {
    // The address that initiated this purchase, kept on the transaction so an
    // investigation can place the request.
    const { ip: initiatorIp } = requestContext(req);
    const auth = await requireUser(req);
    await assertFeatureEnabled("bill_payments");
    await enforceRateLimit(`bill:pay:${auth.id}`, 10, 60_000);

    const idempotencyKey = req.headers.get("idempotency-key");
    if (!idempotencyKey) {
      throw new ApiError(400, "Missing Idempotency-Key header", "no_idempotency_key");
    }
    const body = (await req.json()) as Record<string, string | undefined>;
    const result = await executeBillPayment({
      userId: auth.id,
      service: String(body.service ?? ""),
      billerId: String(body.billerId ?? ""),
      customer: String(body.customer ?? ""),
      planId: body.planId,
      amount: body.amount,
      idempotencyKey,
      initiatorIp,
      // After the replay short-circuit and before the debit, so a wrong PIN
      // neither charges the user nor burns their key.
      authorize: () => requireTransactionPin(auth.id, readPin(req)),
    });
    const { replay: _replay, ...out } = result;
    return jsonOk(out);
  } catch (err) {
    return toErrorResponse(err);
  }
}
