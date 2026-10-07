import { recordAdminAction, requireAdminActor } from "@/lib/adminGuard";
import { unpairScreen } from "@/lib/adsVenues";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Remove a screen (lost, replaced or moved). It shows a new pairing code next time it loads. */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireAdminActor(req, { superOnly: true });
    const { id } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ApiError(404, "Not found", "not_found");
    await unpairScreen(id);
    await recordAdminAction(req, actor, { action: "admin.ads.screen_removed", summary: `Screen ${id} removed`, resourceType: "AdScreen", resourceId: id });
    return jsonOk({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
