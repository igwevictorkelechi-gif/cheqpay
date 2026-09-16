import { requireAdmin } from "@/lib/auth";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { listAllOrders } from "@/lib/gadgetsAdmin";
import { GadgetOrderStatus } from "@cheqpay/db";

export const dynamic = "force-dynamic";

/** Admin: the order queue. Optional ?status= filter. */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    const raw = new URL(req.url).searchParams.get("status");
    const status =
      raw && (Object.values(GadgetOrderStatus) as string[]).includes(raw)
        ? (raw as GadgetOrderStatus)
        : undefined;
    const orders = await listAllOrders(status);
    return jsonOk({ orders });
  } catch (err) {
    return toErrorResponse(err);
  }
}
