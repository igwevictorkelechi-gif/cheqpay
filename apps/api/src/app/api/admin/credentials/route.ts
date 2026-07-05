import { requireAdmin } from "@/lib/auth";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { prisma } from "@cheqpay/db";
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
 * Change the admin dashboard email and/or password. Requires the current
 * password to authorize the change.
 */
export async function PATCH(req: Request) {
  try {
    await requireAdmin(req);
    const body = (await req.json().catch(() => ({}))) as {
      currentPassword?: string;
      email?: string;
      newPassword?: string;
    };
    const currentPassword = String(body.currentPassword ?? "");
    const email = body.email ? String(body.email) : undefined;
    const newPassword = body.newPassword ? String(body.newPassword) : undefined;

    if (!email && !newPassword) {
      throw new ApiError(422, "Provide a new email or password", "nothing_to_update");
    }
    if (newPassword && newPassword.length < 8) {
      throw new ApiError(422, "Password must be at least 8 characters", "weak_password");
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new ApiError(422, "Enter a valid email", "bad_email");
    }

    // Authorize with the current password (against the current email).
    const currentEmail = await getAdminEmail();
    if (!(await verifyAdminLogin(currentEmail, currentPassword))) {
      throw new ApiError(401, "Current password is incorrect", "bad_current_password");
    }

    await setAdminCredential({ email, password: newPassword }, currentEmail);
    await prisma.auditLog.create({
      data: {
        action: "admin.credentials.updated",
        resourceType: "PlatformSetting",
        resourceId: "admin_login",
        details: { emailChanged: !!email, passwordChanged: !!newPassword, by: currentEmail },
      },
    });

    return jsonOk({ email: await getAdminEmail() });
  } catch (err) {
    return toErrorResponse(err);
  }
}
