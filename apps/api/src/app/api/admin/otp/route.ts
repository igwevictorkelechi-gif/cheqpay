import { z } from "zod";
import { prisma } from "@cheqpay/db";
import { requireAdmin } from "@/lib/auth";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
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
  z.object({ action: z.literal("setup") }),
  z.object({ action: z.literal("activate"), code: z.string().min(6).max(8) }),
]);

/** Admin: begin OTP setup (returns otpauth URI to scan) or activate with a code. */
export async function POST(req: Request) {
  try {
    await requireAdmin(req);
    const actor = req.headers.get("x-admin-actor") ?? "admin";
    const body = actionSchema.parse(await req.json());

    if (body.action === "setup") {
      const { secret, otpauthUrl } = await beginAdminOtpSetup(actor);
      return jsonOk({ secret, otpauthUrl });
    }

    const ok = await activateAdminOtp(body.code, actor);
    if (!ok) {
      throw new ApiError(422, "That code didn’t match. Check your authenticator app and try again.", "bad_otp");
    }
    await prisma.auditLog.create({
      data: { action: "admin.otp.activated", details: { actor } },
    });
    return jsonOk({ configured: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
