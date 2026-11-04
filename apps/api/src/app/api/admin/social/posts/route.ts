import { recordAdminAction, requireAdminActor } from "@/lib/adminGuard";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { POST_STATUSES, type PostStatus } from "@/lib/social/rules";
import { createPost, listPosts } from "@/lib/social/store";
import { parsePostInput } from "@/lib/social/validation";

export const dynamic = "force-dynamic";

function date(v: string | null): Date | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** Admin (Social): posts in a time window (?from&to ISO), optionally one status. */
export async function GET(req: Request) {
  try {
    await requireAdminActor(req, { section: "social" });
    const q = new URL(req.url).searchParams;
    const status = q.get("status");
    const posts = await listPosts({
      from: date(q.get("from")),
      to: date(q.get("to")),
      status: status && (POST_STATUSES as readonly string[]).includes(status) ? (status as PostStatus) : undefined,
    });
    return jsonOk({ posts });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** Admin (Social): create a draft. */
export async function POST(req: Request) {
  try {
    const actor = await requireAdminActor(req, { section: "social" });
    const post = await createPost(parsePostInput(await req.json()), actor.email);
    await recordAdminAction(req, actor, {
      action: "admin.social.post_created",
      summary: `Drafted a social post for ${post.targets.length} account(s)`,
      resourceType: "SocialPost",
      resourceId: post.id,
    });
    return jsonOk({ post });
  } catch (err) {
    return toErrorResponse(err);
  }
}
