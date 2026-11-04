import { after } from "next/server";
import { recordAdminAction, requireAdminActor } from "@/lib/adminGuard";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { runPublisher } from "@/lib/social/publisher";
import { approvePost, rejectPost, retryPost, submitPost, unschedulePost } from "@/lib/social/store";
import { assertUuid, rejectSchema } from "@/lib/social/validation";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string; action: string }> };

const SUMMARY: Record<string, string> = {
  submit: "Sent a social post for approval",
  approve: "Approved a social post",
  reject: "Sent a social post back with changes",
  unschedule: "Unscheduled a social post",
  retry: "Retried a failed social post",
};

/** Admin (Social): submit | approve | reject | unschedule | retry. */
export async function POST(req: Request, ctx: Ctx) {
  try {
    const actor = await requireAdminActor(req, { section: "social" });
    const { id: rawId, action } = await ctx.params;
    const id = assertUuid(rawId);
    let post;
    let note: string | undefined;
    switch (action) {
      case "submit":
        post = await submitPost(id);
        break;
      case "approve":
        post = await approvePost(id, actor);
        break;
      case "reject":
        note = rejectSchema.parse(await req.json()).note;
        post = await rejectPost(id, note);
        break;
      case "unschedule":
        post = await unschedulePost(id);
        break;
      case "retry":
        post = await retryPost(id);
        break;
      default:
        throw new ApiError(404, "Unknown action.", "not_found");
    }
    // Due now: start sending right after responding; the minute job picks up the rest.
    if (post.status === "publishing") {
      after(() => runPublisher({ postId: id, budgetMs: 90_000 }).catch((err) => console.error("[social] publish-now failed", err)));
    }
    await recordAdminAction(req, actor, {
      action: `admin.social.post_${action}`,
      summary: SUMMARY[action],
      resourceType: "SocialPost",
      resourceId: id,
      details: note ? { note } : undefined,
    });
    return jsonOk({ post });
  } catch (err) {
    return toErrorResponse(err);
  }
}
