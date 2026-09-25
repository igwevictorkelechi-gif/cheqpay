import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { assertFeatureEnabled } from "@/lib/features";
import { enforceRateLimit } from "@/lib/ratelimit";
import { quoteDiscount } from "@/lib/gadgetDiscounts";

export const dynamic = "force-dynamic";

const quoteSchema = z.object({
  code: z.string().min(1).max(40),
  productId: z.string().uuid(),
  quantity: z.number().int().min(1).max(20),
});

/**
 * Preview a discount code against a product + quantity, so the storefront can
 * show the discounted total before checkout. Read-only — the code is applied
 * authoritatively in the checkout route.
 */
export async function POST(req: Request) {
  try {
    const auth = await requireUser(req);
    await assertFeatureEnabled("gadgets");
    await enforceRateLimit(`gadget:discount:${auth.id}`, 20, 60_000);

    const body = quoteSchema.parse(await req.json());
    const quote = await quoteDiscount(body);
    return jsonOk({ quote });
  } catch (err) {
    return toErrorResponse(err);
  }
}
