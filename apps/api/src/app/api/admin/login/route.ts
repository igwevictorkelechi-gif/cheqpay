import { prisma } from "@cheqpay/db";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { enforceRateLimit } from "@/lib/ratelimit";
import { verifyAdminLogin, getAdminEmail } from "@/lib/adminCreds";
import { consumeAdminOtp, isAdminOtpConfigured } from "@/lib/totp";
import { getAdminSessionEpoch } from "@/lib/adminSession";
import { clientIp } from "@/lib/requestContext";
import { isIpBlocked } from "@/lib/accessControl";

export const dynamic = "force-dynamic";

/**
 * Verify admin dashboard credentials. Public (this IS the login), so it is
 * throttled per address as well as overall, and every attempt is audited.
 *
 * Two factors once the admin authenticator is enrolled: the password alone no
 * longer opens the dashboard. In the 22 Sep incident a password was all it
 * took. A correct password without a code returns `otp_required`, which the
 * login page answers by asking for the code.
 *
 * Returns the canonical admin email and the current session epoch; the admin
 * app signs both into its session cookie so the session can be revoked.
 */
export async function POST(req: Request) {
  // The dashboard calls this from its own server, so the socket address is the
  // dashboard's, not the person signing in. It forwards the real one. A direct
  // caller could forge that header, but a direct call only gets a yes/no — it
  // cannot mint a session, which only the dashboard (holding the signing
  // secret) can do — so the forwarded address is safe to use here.
  const forwarded = (req.headers.get("x-admin-client-ip") ?? "").trim();
  const ip = /^[0-9a-f:.]{3,45}$/i.test(forwarded) ? forwarded : clientIp(req);
  try {
    enforceRateLimit("admin:login", 20, 60_000);
    enforceRateLimit(`admin:login:${ip ?? "unknown"}`, 5, 60_000);
    if (ip && (await isIpBlocked(ip))) {
      throw new ApiError(403, "Access from this network has been blocked.", "ip_blocked");
    }

    const body = (await req.json().catch(() => ({}))) as {
      email?: string;
      password?: string;
      otp?: string;
    };
    const email = String(body.email ?? "");
    const password = String(body.password ?? "");

    if (!email || !password) {
      return jsonOk({ error: "Email and password are required", code: "missing" }, 400);
    }
    if (!(await verifyAdminLogin(email, password))) {
      await audit("admin.login.failed", ip, { email: email.toLowerCase().slice(0, 200), reason: "bad_credentials" });
      return jsonOk({ error: "Invalid email or password", code: "bad_credentials" }, 401);
    }

    if (await isAdminOtpConfigured()) {
      const otp = String(body.otp ?? "").replace(/\D/g, "");
      if (!otp) {
        return jsonOk({ error: "Enter the code from your authenticator app", code: "otp_required" }, 401);
      }
      if (!(await consumeAdminOtp(otp))) {
        await audit("admin.login.failed", ip, { email: email.toLowerCase().slice(0, 200), reason: "bad_otp" });
        return jsonOk({ error: "That code didn't work. Wait for the next one and try again.", code: "bad_otp" }, 401);
      }
    }

    const canonical = await getAdminEmail();
    await audit("admin.login.succeeded", ip, { email: canonical, secondFactor: await isAdminOtpConfigured() });
    return jsonOk({
      ok: true,
      email: canonical,
      epoch: await getAdminSessionEpoch(),
      otpConfigured: await isAdminOtpConfigured(),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

async function audit(action: string, ip: string | null, details: Record<string, unknown>): Promise<void> {
  await prisma.auditLog
    .create({ data: { action, resourceType: "admin_login", ipAddress: ip, details: details as never } })
    .catch((err) => console.error("[admin login] audit failed", err));
}
