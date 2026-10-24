import { z } from "zod";
import { requireAdminActor } from "@/lib/adminGuard";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { reorderHomeBanners } from "@/lib/homeBanner";

export const dynamic = "force-dynamic";

const orderSchema = z.object({ order: z.array(z.string().uuid()).max(50) });

/** Admin: set the carousel's order. Must list exactly the current banners. */
export async function PUT(req: Request) {
  try {
    const actor = (await requireAdminActor(req)).email;
    const { order } = orderSchema.parse(await req.json());
    if (!(await reorderHomeBanners(order, actor))) {
      throw new ApiError(409, "The banners changed since this page loaded. Reload and try again.", "stale_order");
    }
    return jsonOk({ order });
  } catch (err) {
    return toErrorResponse(err);
  }
}
