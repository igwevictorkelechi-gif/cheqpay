import { requireAdminActor } from "@/lib/adminGuard";
import { subAdminStateFor } from "@/lib/auth";
import { jsonOk, toErrorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * The signed-in admin as the backend sees them right now: role, the dashboard
 * sections they may open, whether they must still change their password, and
 * (for a sub admin) whether their own authenticator is set up.
 *
 * The dashboard reads this on every page load to refresh its session, so a
 * section a Super Admin grants or removes shows up without signing in again.
 */
export async function GET(req: Request) {
  try {
    const actor = await requireAdminActor(req);
    if (actor.role === "super") {
      return jsonOk({ email: actor.email, role: "super", sections: actor.sections, mustChangePassword: false, otpEnrolled: true });
    }
    const state = await subAdminStateFor(req, actor.email);
    return jsonOk({
      email: actor.email,
      role: "admin",
      sections: state.sections,
      mustChangePassword: state.mustChange,
      otpEnrolled: state.otpEnrolled,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
