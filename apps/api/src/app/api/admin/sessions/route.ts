import { jsonOk, toErrorResponse } from "@/lib/http";
import { recordAdminAction, requireAdminActor, rotateAdminSessionEpoch } from "@/lib/adminGuard";

export const dynamic = "force-dynamic";

/**
 * Admin: sign out every admin session, everywhere, now.
 *
 * Any signed-in admin may do this, with no second factor: it only ever takes
 * access away, and it is the button to press the moment something looks wrong.
 * Every session — including the caller's — is refused from its next request.
 */
export async function POST(req: Request) {
  try {
    const actor = await requireAdminActor(req);
    await rotateAdminSessionEpoch(actor.email);
    await recordAdminAction(req, actor, {
      action: "admin.sessions.revoked_all",
      summary: "All admin sessions signed out",
      resourceType: "admin_session",
    });
    return jsonOk({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
