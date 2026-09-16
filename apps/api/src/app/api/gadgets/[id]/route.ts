import { requireUser } from "@/lib/auth";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { assertFeatureEnabled } from "@/lib/features";
import { getActiveProduct } from "@/lib/gadgets";

export const dynamic = "force-dynamic";

/** One product's detail for the storefront. */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    await requireUser(req);
    await assertFeatureEnabled("gadgets");
    const product = await getActiveProduct(params.id);
    return jsonOk({ product });
  } catch (err) {
    return toErrorResponse(err);
  }
}
