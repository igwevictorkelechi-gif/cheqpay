import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { assertFeatureEnabled } from "@/lib/features";
import { enforceRateLimit } from "@/lib/ratelimit";
import { readPin, requireTransactionPin } from "@/lib/transactionPin";
import { checkoutTickets, listUserTickets } from "@/lib/events";

export const dynamic = "force-dynamic";

const checkoutSchema = z.object({
  eventId: z.string().uuid(),
  tierId: z.string().uuid(),
  quantity: z.number().int().min(1).max(10),
});

/** The signed-in user's tickets, newest first. */
export async function GET(req: Request) {
  try {
    const auth = await requireUser(req);
    await assertFeatureEnabled("events");
    const tickets = await listUserTickets(auth.id);
    return jsonOk({ tickets });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * Buy tickets. Money-safe:
 *   - the tier price is resolved on the server, never trusted from the body;
 *   - the transaction PIN authorises the spend, checked before the lib runs;
 *   - the debit + capacity decrement + order + tickets + ledger row settle in
 *     one guarded transaction;
 *   - it is idempotent on the Idempotency-Key header.
 */
export async function POST(req: Request) {
  try {
    const auth = await requireUser(req);
    await assertFeatureEnabled("events");
    enforceRateLimit(`ticket:buy:${auth.id}`, 10, 60_000);

    const idempotencyKey = req.headers.get("idempotency-key");
    if (!idempotencyKey) {
      throw new ApiError(400, "Missing Idempotency-Key header", "no_idempotency_key");
    }

    const body = checkoutSchema.parse(await req.json());
    await requireTransactionPin(auth.id, readPin(req));

    const order = await checkoutTickets({
      userId: auth.id,
      eventId: body.eventId,
      tierId: body.tierId,
      quantity: body.quantity,
      idempotencyKey,
    });

    return jsonOk({ order }, 201);
  } catch (err) {
    return toErrorResponse(err);
  }
}
