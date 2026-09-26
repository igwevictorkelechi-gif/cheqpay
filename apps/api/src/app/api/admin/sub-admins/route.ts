import { recordAdminAction, requireAdminActor, requireAdminOtp } from "@/lib/adminGuard";
import {
  deleteSubAdmin,
  getAdminEmail,
  isStrongAdminPassword,
  listSubAdmins,
  setSubAdminPassword,
} from "@/lib/adminCreds";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function readEmail(v: unknown): string {
  const email = String(v ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 200) {
    throw new ApiError(422, "Enter a valid email", "bad_email");
  }
  return email;
}

/** Super Admin: every sub admin and whether they've set their own password yet. */
export async function GET(req: Request) {
  try {
    await requireAdminActor(req, { superOnly: true });
    return jsonOk({ subAdmins: await listSubAdmins() });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * Super Admin: create a sub admin, or reset one's password. The password is the
 * starting one the Super Admin hands over; the sub admin must replace it on
 * first sign-in. Needs a fresh authenticator code, like every grant of access.
 */
export async function POST(req: Request) {
  try {
    const actor = await requireAdminActor(req, { superOnly: true });
    const body = (await req.json().catch(() => ({}))) as { email?: unknown; password?: unknown; otp?: unknown };
    const email = readEmail(body.email);
    const password = String(body.password ?? "");
    if (!isStrongAdminPassword(password)) {
      throw new ApiError(422, "Use at least 12 characters, with letters and numbers", "weak_password");
    }
    if (email === (await getAdminEmail()) || (process.env.ADMIN_EMAILS ?? "").toLowerCase().split(",").map((e) => e.trim()).includes(email)) {
      throw new ApiError(422, "That email is already a Super Admin", "is_super_admin");
    }
    await requireAdminOtp(req, body.otp);

    const existed = (await listSubAdmins()).some((s) => s.email === email && s.status !== "no_password");
    await setSubAdminPassword(email, password, actor.email);
    await recordAdminAction(req, actor, {
      action: existed ? "admin.subadmin.password_reset" : "admin.subadmin.created",
      summary: existed ? `Sub admin password reset: ${email}` : `Sub admin added: ${email}`,
      resourceType: "AdminAccount",
      resourceId: email,
      details: { email },
    });
    return jsonOk({ subAdmins: await listSubAdmins() });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** Super Admin: remove a sub admin. Their next click is refused. */
export async function DELETE(req: Request) {
  try {
    const actor = await requireAdminActor(req, { superOnly: true });
    const body = (await req.json().catch(() => ({}))) as { email?: unknown; otp?: unknown };
    const email = readEmail(body.email);
    await requireAdminOtp(req, body.otp);
    await deleteSubAdmin(email, actor.email);
    await recordAdminAction(req, actor, {
      action: "admin.subadmin.removed",
      summary: `Sub admin removed: ${email}`,
      resourceType: "AdminAccount",
      resourceId: email,
      details: { email },
    });
    return jsonOk({ subAdmins: await listSubAdmins() });
  } catch (err) {
    return toErrorResponse(err);
  }
}
