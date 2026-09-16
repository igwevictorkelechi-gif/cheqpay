import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { assertFeatureEnabled } from "@/lib/features";
import { enforceRateLimit } from "@/lib/ratelimit";
import { readPin, requireTransactionPin } from "@/lib/transactionPin";
import { checkoutGadget, listUserOrders } from "@/lib/gadgets";

export const dynamic = "force-dynamic";

const checkoutSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().min(1).max(20),
  delivery: z.object({
    name: z.string().min(1).max(120),
    phone: z.string().min(1).max(40),
    address: z.string().min(1).max(300),
    city: z.string().min(1).max(120),
    state: z.string().min(1).max(120),
  }),
  note: z.string().max(500).optional(),
});

/** The signed-in user's own orders, newest first. */
export async function GET(req: Request) {
  try {
    const auth = await requireUser(req);
    await assertFeatureEnabled("gadgets");
    const orders = await listUserOrders(auth.id);
    return jsonOk({ orders });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * Buy a gadget. Money-safe:
 *   - the price is resolved on the server, never trusted from the body;
 *   - the transaction PIN authorises the spend, checked before the lib runs;
 *   - the debit + order + ledger row settle in one guarded transaction;
 *   - it is idempotent on the Idempotency-Key header.
 */
export async function POST(req: Request) {
  try {
    const auth = await requireUser(req);
    await assertFeatureEnabled("gadgets");
    enforceRateLimit(`gadget:buy:${auth.id}`, 10, 60_000);

    const idempotencyKey = req.headers.get("idempotency-key");
    if (!idempotencyKey) {
      throw new ApiError(400, "Missing Idempotency-Key header", "no_idempotency_key");
    }

    const body = checkoutSchema.parse(await req.json());

    // Authorise the spend before the lib touches money. The lib owns the
    // idempotency replay, so a retried checkout with the same key returns the
    // original order rather than charging again.
    await requireTransactionPin(auth.id, readPin(req));

    const order = await checkoutGadget({
      userId: auth.id,
      productId: body.productId,
      quantity: body.quantity,
      delivery: body.delivery,
      note: body.note,
      idempotencyKey,
    });

    return jsonOk({ order }, 201);
  } catch (err) {
    return toErrorResponse(err);
  }
}
