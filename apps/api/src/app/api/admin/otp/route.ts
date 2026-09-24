import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import {
  recordAdminAction,
  requireAdminActor,
  requireAdminOtp,
  rotateAdminSessionEpoch,
} from "@/lib/adminGuard";
import {
  activateAdminOtp,
  beginAdminOtpSetup,
  isAdminOtpConfigured,
} from "@/lib/totp";

export const dynamic = "force-dynamic";

/** Admin: whether transaction OTP (authenticator app) is set up. */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    return jsonOk({ configured: await isAdminOtpConfigured() });
  } catch (err) {
    return toErrorResponse(err);
  }
}

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("setup"), currentOtp: z.string().optional() }),
  z.object({ action: z.literal("activate"), code: z.string().min(6).max(8) }),
]);

/** True when the deployment explicitly allows replacing a lost authenticator. */
function breakGlass(): boolean {
  return (getEnv().ADMIN_OTP_RESET_ALLOWED ?? "").toLowerCase() === "true";
}

/**
 * Admin: begin OTP setup (returns otpauth URI to scan) or activate with a code.
 *
 * Replacing an enrolled authenticator needs a code FROM that authenticator. It
 * did not before, and that is how the second factor was defeated on 22 Sep: a
 * session with only a password enrolled its own phone and, ten seconds later,
 * was approving money with its own codes. Now a session alone can only set up
 * the FIRST authenticator. Replacing one needs the old one, or — for a lost
 * phone — the deployment's ADMIN_OTP_RESET_ALLOWED switch, which only someone
 * with access to the hosting environment can flip.
 *
 * Replacing an authenticator also signs out every admin session.
 */
export async function POST(req: Request) {
  try {
    const actor = await requireAdminActor(req, { superOnly: true });
    const body = actionSchema.parse(await req.json());
    const replacing = await isAdminOtpConfigured();

    if (body.action === "setup") {
      if (replacing) {
        if (breakGlass()) {
          // Allowed without the old code, but loudly.
        } else {
          await requireAdminOtp(req, body.currentOtp);
        }
      }
      const { secret, otpauthUrl } = await beginAdminOtpSetup(actor.email);
      await recordAdminAction(req, actor, {
        action: "admin.otp.setup_started",
        summary: replacing
          ? `Admin authenticator REPLACEMENT started${breakGlass() ? " using the break-glass switch" : ""}`
          : "Admin authenticator setup started",
        resourceType: "PlatformSetting",
        resourceId: "admin_totp_secret",
        details: { replacing, breakGlass: replacing && breakGlass() },
      });
      return jsonOk({ secret, otpauthUrl });
    }

    const ok = await activateAdminOtp(body.code, actor.email);
    if (!ok) {
      throw new ApiError(422, "That code didn’t match. Check your authenticator app and try again.", "bad_otp");
    }
    if (replacing) await rotateAdminSessionEpoch(actor.email);
    await recordAdminAction(req, actor, {
      action: "admin.otp.activated",
      summary: replacing
        ? "Admin authenticator REPLACED — all admin sessions signed out"
        : "Admin authenticator enrolled",
      resourceType: "PlatformSetting",
      resourceId: "admin_totp_secret",
      details: { replacing },
    });
    return jsonOk({ configured: true, signedOut: replacing });
  } catch (err) {
    return toErrorResponse(err);
  }
}
