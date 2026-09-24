import { requireAdmin } from "@/lib/auth";
import {
  recordAdminAction,
  requireAdminActor,
  requireAdminOtp,
  rotateAdminSessionEpoch,
} from "@/lib/adminGuard";
import { isAdminOtpConfigured } from "@/lib/totp";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import {
  getAdminEmail,
  isDefaultCredential,
  verifyAdminLogin,
  setAdminCredential,
} from "@/lib/adminCreds";

export const dynamic = "force-dynamic";

/** Current admin login email + whether it's still the default. */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    return jsonOk({ email: await getAdminEmail(), isDefault: await isDefaultCredential() });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * Change the admin dashboard email and/or password.
 *
 * Needs the current password AND, once enrolled, a code from the admin
 * authenticator — a session alone cannot take over the login. A successful
 * change signs out every other admin session, including any held by whoever
 * the change is meant to lock out.
 */
export async function PATCH(req: Request) {
  try {
    const actor = await requireAdminActor(req);
    const body = (await req.json().catch(() => ({}))) as {
      currentPassword?: string;
      email?: string;
      newPassword?: string;
      otp?: string;
    };
    const currentPassword = String(body.currentPassword ?? "");
    const email = body.email ? String(body.email) : undefined;
    const newPassword = body.newPassword ? String(body.newPassword) : undefined;

    if (!email && !newPassword) {
      throw new ApiError(422, "Provide a new email or password", "nothing_to_update");
    }
    if (newPassword && (newPassword.length < 12 || !/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword))) {
      throw new ApiError(
        422,
        "Use at least 12 characters, with letters and numbers",
        "weak_password",
      );
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new ApiError(422, "Enter a valid email", "bad_email");
    }

    // Authorize with the current password (against the current email).
    const currentEmail = await getAdminEmail();
    if (!(await verifyAdminLogin(currentEmail, currentPassword))) {
      throw new ApiError(401, "Current password is incorrect", "bad_current_password");
    }

    if (await isAdminOtpConfigured()) await requireAdminOtp(req, body.otp);

    await setAdminCredential({ email, password: newPassword }, currentEmail);
    // Every session minted before this change stops working on its next call.
    // The admin making the change signs in again with the new credentials.
    await rotateAdminSessionEpoch(actor.email);
    await recordAdminAction(req, actor, {
      action: "admin.credentials.updated",
      summary: `Admin login ${[email && "email", newPassword && "password"].filter(Boolean).join(" and ")} changed; all admin sessions signed out`,
      resourceType: "PlatformSetting",
      resourceId: "admin_login",
      details: { emailChanged: !!email, passwordChanged: !!newPassword, by: currentEmail },
    });

    return jsonOk({ email: await getAdminEmail(), signedOut: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
