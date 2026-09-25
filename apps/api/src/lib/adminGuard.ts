// apps/api/src/lib/adminGuard.ts
//
// The rules every sensitive admin action goes through.
//
// Written after the 22 Sep 2026 incident, in which a single admin session:
// raised an unverified account to KYC tier 3, re-enrolled the admin OTP to its
// own authenticator, credited 10,000 USDT and 1 BTC out of nothing, unblocked
// the account after it had been blocked, and approved its withdrawal. Every one
// of those steps was logged as "admin" — nobody could say who. Each rule below
// closes one of those doors:
//
//  - IDENTITY. A sensitive action must name the signed-in admin. The dashboard
//    proxy forwards the email from its verified session; an anonymous call is
//    refused, so the audit trail always says who.
//  - REVOCATION. Every dashboard session carries the session epoch it was minted
//    under. Changing the admin password, resetting OTP, or pressing "sign out
//    everywhere" rotates the epoch, and every older session stops working on
//    its next call. Before this, a stolen cookie was valid forever.
//  - STEP-UP. Money-moving and trust-granting actions need a fresh code from the
//    admin authenticator, per action, one use each. A session alone is not
//    enough to move money.
//  - ALERTS. Each sensitive action is announced to the ops webhook and emailed
//    to the security contact as it happens, so an abuse is seen in minutes, not
//    the next morning.

import { enforceRateLimit } from "./ratelimit";
import { after } from "next/server";
import { prisma } from "@cheqpay/db";
import { requireAdmin, requireUser, isAdminUser } from "./auth";
import { getEnv } from "./env";
import { ApiError, ForbiddenError } from "./http";
import { consumeAdminOtp, isAdminOtpConfigured } from "./totp";
import { notifyAdminAlert } from "./adminAlert";
import { isEmailConfigured, sendEmail } from "./email";
import { clientIp } from "./requestContext";
import { assertSessionCurrent } from "./adminSession";

export { getAdminSessionEpoch, rotateAdminSessionEpoch } from "./adminSession";

export type AdminRole = "admin" | "super";

export interface AdminActor {
  email: string;
  role: AdminRole;
}

// ---------------------------------------------------------------------------
// Identity.
// ---------------------------------------------------------------------------

function looksLikeEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function hasServiceSecret(req: Request): boolean {
  const expected = getEnv().ADMIN_API_SECRET;
  const provided = req.headers.get("x-admin-secret");
  if (!expected || !provided || expected.length !== provided.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) mismatch |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  return mismatch === 0;
}

/**
 * Who is performing this admin action. Refuses anonymous calls.
 *
 * Through the dashboard (service secret), the proxy forwards the email and role
 * from the session it verified, plus the session epoch; all three are required.
 * Through a Supabase admin token, the token's own email is used.
 */
export async function requireAdminActor(
  req: Request,
  opts: { superOnly?: boolean } = {},
): Promise<AdminActor> {
  await requireAdmin(req);

  let actor: AdminActor;
  if (hasServiceSecret(req)) {
    const email = (req.headers.get("x-admin-actor") ?? "").trim().toLowerCase();
    const role = req.headers.get("x-admin-role") === "super" ? "super" : "admin";
    if (!looksLikeEmail(email) || req.headers.get("x-admin-epoch") === null) {
      throw new ApiError(
        401,
        "This action needs a signed-in admin. Please sign in to the dashboard again.",
        "admin_identity_required",
      );
    }
    await assertSessionCurrent(req);
    actor = { email, role };
  } else {
    const auth = await requireUser(req);
    actor = { email: (auth.email ?? "").toLowerCase(), role: isAdminUser(auth) ? "super" : "admin" };
    if (!looksLikeEmail(actor.email)) {
      throw new ApiError(401, "Admin identity could not be established.", "admin_identity_required");
    }
  }

  if (opts.superOnly && actor.role !== "super") {
    throw new ForbiddenError("Only a Super Admin can do this.");
  }
  return actor;
}

// ---------------------------------------------------------------------------
// Step-up: a fresh authenticator code per action.
// ---------------------------------------------------------------------------

/**
 * Require a fresh admin OTP for this one action.
 *
 * Read from the `x-admin-otp` header, or `otp` in the body for routes that
 * already took it there. Refused outright when no authenticator is enrolled:
 * an action that needs a second factor must not quietly proceed without one.
 */
export async function requireAdminOtp(req: Request, bodyOtp?: unknown): Promise<void> {
  if (!(await isAdminOtpConfigured())) {
    throw new ApiError(
      403,
      "Set up the admin authenticator first (Adjust Balance page → Set up authenticator).",
      "otp_not_configured",
    );
  }
  const code = String(req.headers.get("x-admin-otp") ?? bodyOtp ?? "").replace(/\D/g, "");
  if (code.length !== 6) {
    throw new ApiError(403, "Enter the 6-digit code from your authenticator app.", "otp_required");
  }
  // One shared authenticator, so one shared budget of guesses: 1,000,000 codes
  // can't be walked 10 at a time.
  await enforceRateLimit("admin-otp-attempts", 10, 15 * 60_000);
  if (!(await consumeAdminOtp(code))) {
    throw new ApiError(
      403,
      "That code didn’t work. Codes can only be used once — wait for the next one and try again.",
      "bad_otp",
    );
  }
}

// ---------------------------------------------------------------------------
// Audit + alert.
// ---------------------------------------------------------------------------

/**
 * Record a sensitive admin action with the admin who did it, and announce it.
 *
 * The audit row is written inline (it is the record); the alert is sent after
 * the response, and never fails the action.
 */
export async function recordAdminAction(
  req: Request,
  actor: AdminActor,
  entry: {
    action: string;
    summary: string;
    userId?: string | null;
    resourceType?: string;
    resourceId?: string | null;
    details?: Record<string, unknown>;
  },
): Promise<void> {
  const ip = clientIp(req);
  await prisma.auditLog.create({
    data: {
      userId: entry.userId ?? null,
      action: entry.action,
      resourceType: entry.resourceType ?? "admin",
      resourceId: entry.resourceId ?? entry.userId ?? null,
      ipAddress: ip,
      details: { actor: actor.email, role: actor.role, ...(entry.details ?? {}) } as never,
    },
  });

  const send = () => announce(actor, entry.summary, entry.action).catch(() => undefined);
  try {
    after(send);
  } catch {
    void send();
  }
}

function securityRecipients(): string[] {
  const env = getEnv();
  const raw = env.ADMIN_SECURITY_EMAIL || env.ADMIN_EMAILS || "";
  return raw
    .split(",")
    .map((e) => e.trim())
    .filter(looksLikeEmail)
    .slice(0, 5);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

async function announce(actor: AdminActor, summary: string, action: string): Promise<void> {
  const when = new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC";
  const line = `🔐 CheqPay admin action — ${summary} — by ${actor.email} (${actor.role}) at ${when}`;
  await notifyAdminAlert(line, { action, actor: actor.email, at: when });

  if (!isEmailConfigured()) return;
  for (const to of securityRecipients()) {
    await sendEmail({
      to,
      subject: `Admin action: ${summary}`,
      html:
        `<p><strong>${escapeHtml(summary)}</strong></p>` +
        `<p>By <strong>${escapeHtml(actor.email)}</strong> (${actor.role}) at ${when}.</p>` +
        `<p>If this wasn't you or someone on your team, open the admin dashboard now, ` +
        `use <em>Sign out everywhere</em>, and change the admin password.</p>`,
    }).catch((err) => console.error("[adminGuard] security email failed", err));
  }
}
