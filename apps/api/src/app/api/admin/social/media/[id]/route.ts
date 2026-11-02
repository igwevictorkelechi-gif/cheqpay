import { requireAdminActor } from "@/lib/adminGuard";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { completeMedia, mediaPreviewUrl } from "@/lib/social/store";
import { assertUuid } from "@/lib/social/validation";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Admin (Social): a short-lived link to view an uploaded file. */
export async function GET(req: Request, ctx: Ctx) {
  try {
    await requireAdminActor(req, { section: "social" });
    return jsonOk({ url: await mediaPreviewUrl(assertUuid((await ctx.params).id)) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** Admin (Social): confirm the browser's upload landed. */
export async function POST(req: Request, ctx: Ctx) {
  try {
    await requireAdminActor(req, { section: "social" });
    return jsonOk({ media: await completeMedia(assertUuid((await ctx.params).id)) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
