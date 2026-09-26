import { requireAdminActor } from "@/lib/adminGuard";
import { changeOwnSubAdminPassword, isStrongAdminPassword } from "@/lib/adminCreds";
import { enforceRateLimit } from "@/lib/ratelimit";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * A sub admin replaces their own password — required on first sign-in, when
 * they are still using the starting password a Super Admin gave them.
 */
export async function PATCH(req: Request) {
  try {
    const actor = await requireAdminActor(req);
    if (actor.role === "super") {
      throw new ApiError(400, "Change the main admin password from Admin Profile.", "use_profile");
    }
    await enforceRateLimit(`admin:me:password:${actor.email}`, 10, 15 * 60_000);
    const body = (await req.json().catch(() => ({}))) as { currentPassword?: unknown; newPassword?: unknown };
    const currentPassword = String(body.currentPassword ?? "");
    const newPassword = String(body.newPassword ?? "");
    if (!isStrongAdminPassword(newPassword)) {
      throw new ApiError(422, "Use at least 12 characters, with letters and numbers", "weak_password");
    }
    if (newPassword === currentPassword) {
      throw new ApiError(422, "Choose a password different from the one you were given", "same_password");
    }
    if (!(await changeOwnSubAdminPassword(actor.email, currentPassword, newPassword))) {
      throw new ApiError(401, "Current password is incorrect", "bad_current_password");
    }
    return jsonOk({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
