import { requireAdminActor } from "@/lib/adminGuard";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { enforceRateLimit } from "@/lib/ratelimit";
import { createMedia } from "@/lib/social/store";
import { mediaCreateSchema } from "@/lib/social/validation";

export const dynamic = "force-dynamic";

/**
 * Admin (Social): reserve a media file. Returns a one-time signed URL the
 * browser PUTs the file to, straight into private storage; then the dashboard
 * calls POST /media/:id to confirm it arrived.
 */
export async function POST(req: Request) {
  try {
    const actor = await requireAdminActor(req, { section: "social" });
    await enforceRateLimit(`social-media:${actor.email}`, 60, 60 * 60_000);
    const body = mediaCreateSchema.parse(await req.json());
    return jsonOk(await createMedia({ ...body, actor: actor.email }));
  } catch (err) {
    return toErrorResponse(err);
  }
}
