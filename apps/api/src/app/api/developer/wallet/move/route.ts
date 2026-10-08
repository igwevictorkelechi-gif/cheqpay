import { z } from "zod";
import { Asset } from "@cheqpay/db";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { toMinorUnits } from "@/lib/money";
import { enforceRateLimit } from "@/lib/ratelimit";
import { requestContext } from "@/lib/requestContext";
import { readPin, requireTransactionPin } from "@/lib/transactionPin";
import { requireDeveloper, requireStepUp } from "@/lib/devapi/dashboard";
import { moveMoney } from "@/lib/devapi/walletMoves";
import { transactionObject } from "@/lib/devapi/serialize";

export const dynamic = "force-dynamic";

const schema = z
  .object({
    direction: z.enum(["in", "out"]),
    currency: z.enum(["NGN", "USD"]),
    amount: z.string().regex(/^\d{1,12}(\.\d{1,2})?$/, "Enter an amount like 5000 or 5000.50"),
  })
  .strict();

/**
 * Add money to the live main wallet from your CheqPay balance, or move it back.
 * Needs 2FA and your transaction PIN, and an Idempotency-Key so a retry never
 * moves money twice.
 */
export async function POST(req: Request) {
  try {
    const { ip: initiatorIp } = requestContext(req);
    const s = await requireDeveloper(req);
    requireStepUp(s.user);
    await enforceRateLimit(`dev:move:${s.account.id}`, 20, 60 * 60_000);
    const body = schema.parse(await req.json());
    const idempotencyKey = req.headers.get("idempotency-key");
    if (!idempotencyKey) throw new ApiError(400, "Missing Idempotency-Key header", "no_idempotency_key");
    const amountMinor = toMinorUnits(body.amount, body.currency === "NGN" ? Asset.NGN : Asset.USD);
    await requireTransactionPin(s.user.id, readPin(req), { enforce: true });
    const { transaction, replay } = await moveMoney({
      account: s.account,
      direction: body.direction,
      currency: body.currency,
      amountMinor,
      idempotencyKey,
      initiatorIp,
      userAgent: s.userAgent,
    });
    return jsonOk({ transaction: transactionObject(transaction), replay }, replay ? 200 : 201);
  } catch (err) {
    return toErrorResponse(err);
  }
}
