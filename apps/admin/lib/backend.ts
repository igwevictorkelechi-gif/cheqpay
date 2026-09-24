// The headers every dashboard proxy sends to the backend.
//
// Before this, each of the ~45 proxy routes built its own headers: the admin
// secret and, at most, the literal string "admin-dashboard" as the actor. So
// the backend could never say which admin did anything — the audit log for the
// 22 Sep incident reads "admin" on every line. This is now the one place those
// headers are made, and it always carries the signed-in admin's identity and
// session epoch, read from the verified session cookie.
//
// Server-only: it reads the admin secret and the session cookie.

import { cookies, headers as requestHeaders } from "next/headers";
import { SESSION_COOKIE, sessionInfo } from "./adminAuth";

const ADMIN_SECRET = process.env.ADMIN_API_SECRET ?? "";

/**
 * Backend headers for the current admin request.
 *
 * `extra` is merged last so a route can add Content-Type or forward an OTP. The
 * identity headers are always taken from the session and cannot be overridden
 * by `extra`.
 */
export async function adminHeaders(extra: Record<string, string> = {}): Promise<Record<string, string>> {
  const jar = await cookies();
  const session = await sessionInfo(jar.get(SESSION_COOKIE)?.value);

  const headers: Record<string, string> = { ...extra, "x-admin-secret": ADMIN_SECRET };
  // Strip anything identity-shaped a caller tried to supply; only the session
  // may speak for who is acting.
  for (const k of Object.keys(headers)) {
    const lk = k.toLowerCase();
    if (lk === "x-admin-actor" || lk === "x-admin-role" || lk === "x-admin-epoch") delete headers[k];
  }
  if (session) {
    headers["x-admin-actor"] = session.email;
    headers["x-admin-role"] = session.role;
    headers["x-admin-epoch"] = session.epoch;
  }

  // The one-time authenticator code for a step-up action travels from the
  // browser in `x-admin-otp`. Forwarded here so no individual proxy can forget
  // it; the backend decides which actions need it.
  const otp = (await requestHeaders()).get("x-admin-otp");
  if (otp && /^\d{6}$/.test(otp.trim())) headers["x-admin-otp"] = otp.trim();

  return headers;
}
