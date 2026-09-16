import { requireUser } from "@/lib/auth";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { assertFeatureEnabled } from "@/lib/features";
import { listActiveProducts } from "@/lib/gadgets";

export const dynamic = "force-dynamic";

/** The storefront catalog — active products only. */
export async function GET(req: Request) {
  try {
    await requireUser(req);
    await assertFeatureEnabled("gadgets");
    const products = await listActiveProducts();
    return jsonOk({ products });
  } catch (err) {
    return toErrorResponse(err);
  }
}
