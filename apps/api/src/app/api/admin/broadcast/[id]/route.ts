import { requireAdminActor } from "@/lib/adminGuard";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { messageStats } from "@/lib/webPush";

export const dynamic = "force-dynamic";

/** Admin: how a broadcast did — accepted by the push services, shown on devices, tapped. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminActor(req, { superOnly: true });
    const { id } = await ctx.params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ApiError(404, "Not found", "not_found");
    const stats = await messageStats(id);
    if (!stats) throw new ApiError(404, "Not found", "not_found");
    return jsonOk(stats);
  } catch (err) {
    return toErrorResponse(err);
  }
}
