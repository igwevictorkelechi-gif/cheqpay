import { requireUser } from "@/lib/auth";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { assertFeatureEnabled } from "@/lib/features";
import { getUserOrder } from "@/lib/gadgets";

export const dynamic = "force-dynamic";

/** One of the user's own orders, with its current fulfilment status. */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const auth = await requireUser(req);
    await assertFeatureEnabled("gadgets");
    const order = await getUserOrder(auth.id, params.id);
    return jsonOk({ order });
  } catch (err) {
    return toErrorResponse(err);
  }
}
