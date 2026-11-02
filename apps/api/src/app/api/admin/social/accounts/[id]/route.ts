import { recordAdminAction, requireAdminActor } from "@/lib/adminGuard";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { PLATFORM_LABEL } from "@/lib/social/rules";
import { disconnectAccount } from "@/lib/social/store";
import { assertUuid } from "@/lib/social/validation";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Admin (Social): disconnect an account. Its stored tokens are wiped; queued posts to it are cancelled. */
export async function DELETE(req: Request, ctx: Ctx) {
  try {
    const actor = await requireAdminActor(req, { section: "social" });
    const id = assertUuid((await ctx.params).id);
    const account = await disconnectAccount(id);
    await recordAdminAction(req, actor, {
      action: "admin.social.account_disconnected",
      summary: `Disconnected ${PLATFORM_LABEL[account.platform]} account ${account.name}`,
      resourceType: "SocialAccount",
      resourceId: id,
    });
    return jsonOk({ account });
  } catch (err) {
    return toErrorResponse(err);
  }
}
