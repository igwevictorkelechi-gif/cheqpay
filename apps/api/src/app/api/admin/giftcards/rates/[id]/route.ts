import { recordAdminAction, requireAdminActor, requireAdminOtp } from "@/lib/adminGuard";
import { deleteRate } from "@/lib/giftCards";
import { jsonOk, toErrorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Admin: remove a rate (the card stops being offered in that country/type). */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireAdminActor(req, { superOnly: true });
    await requireAdminOtp(req);
    const { id } = await ctx.params;
    await deleteRate(id);
    await recordAdminAction(req, actor, {
      action: "admin.giftcard.rate_deleted",
      summary: "Gift card rate removed",
      resourceType: "GiftCardRate",
      resourceId: id,
    });
    return jsonOk({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
