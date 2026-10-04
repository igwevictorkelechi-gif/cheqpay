import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { assertFeatureEnabled } from "@/lib/features";
import { MAX_FILES_PER_TRADE, listUserTrades, submitTrade } from "@/lib/giftCards";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { enforceRateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

const tradeSchema = z.object({
  rateId: z.string().uuid(),
  faceValue: z.number().int().min(1).max(100_000),
  code: z.string().max(120).optional(),
  pin: z.string().max(60).optional(),
  fileIds: z.array(z.string().uuid()).max(MAX_FILES_PER_TRADE).default([]),
  note: z.string().max(500).optional(),
});

/** The signed-in user's gift card trades, newest first. */
export async function GET(req: Request) {
  try {
    const auth = await requireUser(req);
    await assertFeatureEnabled("gift_cards_sell");
    return jsonOk({ trades: await listUserTrades(auth.id) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * Submit a gift card for review. The payout is computed on the server from the
 * current rate and locked onto the trade; nothing is paid until an admin
 * approves. Idempotent on the Idempotency-Key header.
 */
export async function POST(req: Request) {
  try {
    const auth = await requireUser(req);
    await assertFeatureEnabled("gift_cards_sell");
    await enforceRateLimit(`gc-trade:${auth.id}`, 10, 60_000);
    const idempotencyKey = req.headers.get("idempotency-key");
    if (!idempotencyKey) throw new ApiError(400, "Missing Idempotency-Key header", "no_idempotency_key");
    const body = tradeSchema.parse(await req.json());
    const trade = await submitTrade({ userId: auth.id, idempotencyKey, ...body });
    return jsonOk({ trade }, 201);
  } catch (err) {
    return toErrorResponse(err);
  }
}
