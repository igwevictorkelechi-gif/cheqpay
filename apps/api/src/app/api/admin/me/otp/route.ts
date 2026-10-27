import { z } from "zod";
import { recordAdminAction, requireAdminActor } from "@/lib/adminGuard";
import { activateSubAdminOtp, beginSubAdminOtpSetup, getSubAdminState } from "@/lib/adminCreds";
import { enforceRateLimit } from "@/lib/ratelimit";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("setup") }),
  z.object({ action: z.literal("activate"), code: z.string().min(6).max(8) }),
]);

async function subAdmin(req: Request) {
  const actor = await requireAdminActor(req);
  if (actor.role === "super") {
    throw new ApiError(400, "The main admin authenticator is set up from Adjust Balance.", "use_main_otp");
  }
  return actor;
}

/** A sub admin: whether their own authenticator is set up. */
export async function GET(req: Request) {
  try {
    const actor = await subAdmin(req);
    return jsonOk({ enrolled: (await getSubAdminState(actor.email)).otpEnrolled });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * A sub admin enrols their own authenticator: "setup" returns the secret to
 * scan, "activate" confirms it with a code. Only the first one: replacing an
 * enrolled authenticator takes a Super Admin (Roles & Access → Reset
 * authenticator), so a stolen session can't swap in its own phone.
 */
export async function POST(req: Request) {
  try {
    const actor = await subAdmin(req);
    await enforceRateLimit(`admin:me:otp:${actor.email}`, 10, 15 * 60_000);
    const body = actionSchema.parse(await req.json());

    if (body.action === "setup") {
      const started = await beginSubAdminOtpSetup(actor.email);
      if (!started) {
        throw new ApiError(
          409,
          "Your authenticator is already set up. To move it to a new phone, ask a Super Admin to reset it.",
          "otp_already_enrolled",
        );
      }
      return jsonOk(started);
    }

    if (!(await activateSubAdminOtp(actor.email, body.code))) {
      throw new ApiError(422, "That code didn’t match. Check your authenticator app and try again.", "bad_setup_code");
    }
    await recordAdminAction(req, actor, {
      action: "admin.subadmin.otp_enrolled",
      summary: `Sub admin enrolled their authenticator: ${actor.email}`,
      resourceType: "AdminAccount",
      resourceId: actor.email,
    });
    return jsonOk({ enrolled: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
