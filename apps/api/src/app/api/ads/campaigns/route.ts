import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { createCampaign, listUserCampaigns, quoteSchema } from "@/lib/ads";
import { assertFeatureEnabled } from "@/lib/features";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { enforceRateLimit } from "@/lib/ratelimit";
import { readPin, requireTransactionPin } from "@/lib/transactionPin";

export const dynamic = "force-dynamic";

const createSchema = quoteSchema.extend({
  businessName: z.string().trim().min(2).max(60),
  headline: z.string().trim().min(3).max(40),
  body: z.string().trim().max(120).default(""),
  image: z.string().min(30).max(700_000),
  linkUrl: z.string().max(500).nullable().optional(),
  cta: z.string().trim().max(20).optional(),
});

/** The advertiser's own campaigns, newest first, with their numbers. */
export async function GET(req: Request) {
  try {
    const auth = await requireUser(req);
    await assertFeatureEnabled("ads");
    return jsonOk({ campaigns: await listUserCampaigns(auth.id) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * Book and pay for a campaign. The price is computed on the server, the PIN
 * authorises the spend, and it is idempotent on the Idempotency-Key header.
 */
export async function POST(req: Request) {
  try {
    const auth = await requireUser(req);
    await assertFeatureEnabled("ads");
    await enforceRateLimit(`ad-buy:${auth.id}`, 10, 60_000);
    const idempotencyKey = req.headers.get("idempotency-key");
    if (!idempotencyKey) throw new ApiError(400, "Missing Idempotency-Key header", "no_idempotency_key");
    const b = createSchema.parse(await req.json());
    await requireTransactionPin(auth.id, readPin(req));
    const campaign = await createCampaign({ userId: auth.id, idempotencyKey, ...b });
    return jsonOk({ campaign }, 201);
  } catch (err) {
    return toErrorResponse(err);
  }
}
