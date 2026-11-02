import { recordAdminAction, requireAdminActor } from "@/lib/adminGuard";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { deletePost, getPost, updatePost } from "@/lib/social/store";
import { assertUuid, parsePostInput } from "@/lib/social/validation";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  try {
    await requireAdminActor(req, { section: "social" });
    return jsonOk({ post: await getPost(assertUuid((await ctx.params).id)) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** Admin (Social): edit. Any edit returns the post to draft, so it needs approving again. */
export async function PUT(req: Request, ctx: Ctx) {
  try {
    const actor = await requireAdminActor(req, { section: "social" });
    const id = assertUuid((await ctx.params).id);
    const post = await updatePost(id, parsePostInput(await req.json()));
    await recordAdminAction(req, actor, {
      action: "admin.social.post_edited",
      summary: "Edited a social post (back to draft)",
      resourceType: "SocialPost",
      resourceId: id,
    });
    return jsonOk({ post });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** Admin (Social): delete the post record. Something already live on a platform stays there. */
export async function DELETE(req: Request, ctx: Ctx) {
  try {
    const actor = await requireAdminActor(req, { section: "social" });
    const id = assertUuid((await ctx.params).id);
    await deletePost(id);
    await recordAdminAction(req, actor, {
      action: "admin.social.post_deleted",
      summary: "Deleted a social post",
      resourceType: "SocialPost",
      resourceId: id,
    });
    return jsonOk({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
