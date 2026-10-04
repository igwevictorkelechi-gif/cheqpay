import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { assertFeatureEnabled } from "@/lib/features";
import { matchesSignature } from "@/lib/fileSignature";
import { storeGiftCardFile } from "@/lib/giftCards";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { enforceRateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

const uploadSchema = z.object({
  image: z.string().min(1).max(7_500_000), // base64, no data: prefix
  contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
});

/** Upload one photo of a gift card (front, back or receipt). Returns its id. */
export async function POST(req: Request) {
  try {
    const auth = await requireUser(req);
    await assertFeatureEnabled("gift_cards_sell");
    await enforceRateLimit(`gc-file:${auth.id}`, 20, 60_000);
    await enforceRateLimit(`gc-file-day:${auth.id}`, 60, 24 * 60 * 60_000);
    const body = uploadSchema.parse(await req.json());
    const bytes = Buffer.from(body.image, "base64");
    if (!matchesSignature(bytes, body.contentType)) {
      throw new ApiError(415, "That file isn't a real photo — upload a JPEG, PNG or WebP image.", "bad_image");
    }
    const id = await storeGiftCardFile(auth.id, bytes, body.contentType);
    return jsonOk({ id }, 201);
  } catch (err) {
    return toErrorResponse(err);
  }
}
