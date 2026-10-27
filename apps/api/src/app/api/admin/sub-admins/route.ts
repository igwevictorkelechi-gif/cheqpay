import { recordAdminAction, requireAdminActor, requireAdminOtp } from "@/lib/adminGuard";
import {
  deleteSubAdmin,
  getAdminEmail,
  isStrongAdminPassword,
  listSubAdmins,
  resetSubAdminOtp,
  setSubAdminPassword,
  setSubAdminSections,
} from "@/lib/adminCreds";
import { cleanSections } from "@/lib/adminSections";
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

/** Super Admin: every sub admin, whether they've set their own password, and what they may open. */
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
    const body = (await req.json().catch(() => ({}))) as {
      email?: unknown;
      password?: unknown;
      otp?: unknown;
      sections?: unknown;
    };
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
    // Sections can be chosen when adding someone; a password reset leaves theirs alone.
    const sections = body.sections === undefined ? null : cleanSections(body.sections);
    if (sections) await setSubAdminSections(email, sections);
    await recordAdminAction(req, actor, {
      action: existed ? "admin.subadmin.password_reset" : "admin.subadmin.created",
      summary: existed ? `Sub admin password reset: ${email}` : `Sub admin added: ${email}`,
      resourceType: "AdminAccount",
      resourceId: email,
      details: { email, ...(sections ? { sections } : {}) },
    });
    return jsonOk({ subAdmins: await listSubAdmins() });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * Super Admin: change what a sub admin may open, or reset their authenticator
 * (a lost phone). Granting access needs a fresh authenticator code, like every
 * grant of trust. The change applies on the sub admin's next click.
 */
export async function PATCH(req: Request) {
  try {
    const actor = await requireAdminActor(req, { superOnly: true });
    const body = (await req.json().catch(() => ({}))) as {
      email?: unknown;
      sections?: unknown;
      resetAuthenticator?: unknown;
      otp?: unknown;
    };
    const email = readEmail(body.email);
    const sections = body.sections === undefined ? null : cleanSections(body.sections);
    const resetAuthenticator = body.resetAuthenticator === true;
    if (!sections && !resetAuthenticator) {
      throw new ApiError(422, "Nothing to change", "nothing_to_change");
    }
    const current = (await listSubAdmins()).find((s) => s.email === email);
    if (!current || current.status === "no_password") {
      throw new ApiError(404, "No sub admin with that email", "no_sub_admin");
    }
    await requireAdminOtp(req, body.otp);

    if (sections) {
      await setSubAdminSections(email, sections);
      const added = sections.filter((s) => !current.sections.includes(s));
      const removed = current.sections.filter((s) => !sections.includes(s));
      await recordAdminAction(req, actor, {
        action: "admin.subadmin.access_changed",
        summary:
          `Sub admin access changed: ${email}` +
          (added.length ? ` — granted ${added.join(", ")}` : "") +
          (removed.length ? ` — removed ${removed.join(", ")}` : ""),
        resourceType: "AdminAccount",
        resourceId: email,
        details: { email, sections, added, removed },
      });
    }
    if (resetAuthenticator) {
      await resetSubAdminOtp(email);
      await recordAdminAction(req, actor, {
        action: "admin.subadmin.otp_reset",
        summary: `Sub admin authenticator reset: ${email}`,
        resourceType: "AdminAccount",
        resourceId: email,
        details: { email },
      });
    }
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
