// Per-admin session auth for the dashboard. Admins sign in with their own
// Supabase credentials; only emails on the ADMIN_EMAILS allowlist are granted a
// session. The session cookie is bound to the admin's email and signed with a
// server-only secret (HMAC), so it can be verified statelessly in both Edge
// middleware and Node route handlers and can't be forged. Uses Web Crypto,
// available in both runtimes.

import { cleanSections, inSections, type AdminSection } from "./adminSections";

export const SESSION_COOKIE = "cheqpay_admin";

export type AdminRole = "admin" | "super";

export interface SessionInfo {
  email: string;
  role: AdminRole;
  /** Unix seconds the session was minted. */
  iat: number;
  /** Backend session epoch at sign-in; rotating it revokes this session. */
  epoch: string;
  /** A sub admin still on the starting password a Super Admin gave them. */
  mustChangePassword: boolean;
  /**
   * The extra sections a Super Admin has granted a sub admin, as of the last
   * refresh (every page load asks the backend again). Empty for a Super Admin,
   * who has everything anyway.
   */
  sections: AdminSection[];
}

/**
 * Hard lifetime of an admin session, enforced on the SIGNED issue time — not
 * just the cookie's maxAge, which is only a hint to the browser. A copied
 * cookie value used to be valid forever; now it dies after this long however it
 * is replayed, and sooner if the epoch is rotated.
 */
export const SESSION_MAX_AGE_S = 60 * 60 * 8;

// Sub admins (role "admin") see the Dashboard and Analytics, their own account
// pages, and the sections a Super Admin has granted them (adminSections.ts).
// Everything else is refused for them, so a new page or proxy is
// Super-Admin-only until someone puts it in a section. The backend enforces the
// same rules on its side.
export const SUB_ADMIN_PASSWORD_PAGE = "/account/password";
export const SUB_ADMIN_AUTHENTICATOR_PAGE = "/account/authenticator";
const SUB_ADMIN_PAGES = ["/", "/dashboard", "/analytics", "/live-map", SUB_ADMIN_AUTHENTICATOR_PAGE];
const SUB_ADMIN_READ_APIS = ["/api/analytics", "/api/transactions", "/api/live-map"];
const SUB_ADMIN_ALWAYS_APIS = ["/api/auth", "/api/account/password"];
/** Their own authenticator and alert subscriptions. */
const SUB_ADMIN_OWN_APIS = ["/api/account/otp", "/api/push"];

export type SubAdminDecision = "allow" | "change_password" | "denied";

export function subAdminAccess(
  pathname: string,
  method: string,
  mustChangePassword: boolean,
  sections: readonly string[] = [],
): SubAdminDecision {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (path.startsWith("/api/")) {
    if (SUB_ADMIN_ALWAYS_APIS.includes(path)) return "allow";
    if (mustChangePassword) return "change_password";
    if (SUB_ADMIN_OWN_APIS.includes(path) || inSections(path, sections)) return "allow";
    return (method === "GET" || method === "HEAD") && SUB_ADMIN_READ_APIS.includes(path) ? "allow" : "denied";
  }
  if (path === SUB_ADMIN_PASSWORD_PAGE) return "allow";
  if (mustChangePassword) return "change_password";
  return SUB_ADMIN_PAGES.includes(path) || inSections(path, sections) ? "allow" : "denied";
}

/** Secret used to sign the session. Falls back to the API secret if set. */
export function adminSecret(): string {
  return process.env.ADMIN_DASHBOARD_SECRET || process.env.ADMIN_API_SECRET || "";
}

// --- base64url helpers (email <-> cookie segment) --------------------------
function b64urlEncode(s: string): string {
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(s: string): string {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
}

async function hmacHex(secret: string, msg: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(msg));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Constant-time string comparison. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

/**
 * Build the signed session cookie value for an authenticated admin.
 *
 * Format (v4):
 *   b64url(email).b64url(role).iat.b64url(epoch).flags.b64url(sections).hmac(`session:v4:${email}:${role}:${iat}:${epoch}:${flags}:${sections}`)
 *
 * Everything that decides what the session may do — who, which role, when it
 * was issued, which epoch, whether the password must still be changed, which
 * sections a sub admin may open — is under the signature, so none of it can be
 * edited client-side. It is trusted in Edge middleware without a database
 * round-trip; the epoch and the sub admin's standing and sections are checked
 * by the backend on every call, and the sections here are refreshed from it on
 * every page load.
 */
export async function sessionCookieValue(
  email: string,
  role: AdminRole,
  epoch: string,
  iat: number = Math.floor(Date.now() / 1000),
  mustChangePassword = false,
  sections: readonly string[] = [],
): Promise<string> {
  const e = email.trim().toLowerCase();
  const flags = mustChangePassword ? "p" : "-";
  const list = role === "super" ? "" : cleanSections(sections).join(",");
  const sig = await hmacHex(adminSecret(), `session:v4:${e}:${role}:${iat}:${epoch}:${flags}:${list}`);
  return `${b64urlEncode(e)}.${b64urlEncode(role)}.${iat}.${b64urlEncode(epoch)}.${flags}.${b64urlEncode(list)}.${sig}`;
}

/**
 * Validate a session cookie and return its contents, or null.
 *
 * v4 carries a sub admin's sections, v3 the "must change password" flag. v3 and
 * v2 (neither) are still read, with no sections, so nobody is signed out by
 * this change; anything older fails, which is what signed out every session
 * copied during the 22 Sep incident.
 */
export async function sessionInfo(cookie: string | undefined): Promise<SessionInfo | null> {
  const secret = adminSecret();
  if (!cookie || !secret) return null;
  const parts = cookie.split(".");
  if (parts.length < 5 || parts.length > 7) return null;
  const version = parts.length === 7 ? 4 : parts.length === 6 ? 3 : 2;
  let email: string;
  let role: string;
  let epoch: string;
  let list = "";
  try {
    email = b64urlDecode(parts[0]);
    role = b64urlDecode(parts[1]);
    epoch = b64urlDecode(parts[3]);
    if (version === 4) list = b64urlDecode(parts[5]);
  } catch {
    return null;
  }
  if (!/^\d{9,11}$/.test(parts[2])) return null;
  const iat = Number(parts[2]);
  const flags = version >= 3 ? parts[4] : "-";
  if (flags !== "-" && flags !== "p") return null;

  const message =
    version === 4
      ? `session:v4:${email}:${role}:${iat}:${epoch}:${flags}:${list}`
      : version === 3
        ? `session:v3:${email}:${role}:${iat}:${epoch}:${flags}`
        : `session:v2:${email}:${role}:${iat}:${epoch}`;
  const expected = await hmacHex(secret, message);
  if (!timingSafeEqual(parts[parts.length - 1], expected)) return null;

  const now = Math.floor(Date.now() / 1000);
  if (iat > now + 60) return null; // issued in the future: not ours
  if (now - iat > SESSION_MAX_AGE_S) return null; // expired, however it is replayed

  const isSuper = role === "super";
  return {
    email,
    role: isSuper ? "super" : "admin",
    iat,
    epoch,
    mustChangePassword: flags === "p",
    sections: isSuper ? [] : cleanSections(list ? list.split(",") : []),
  };
}

/** Cookie options for a session minted at `iat`: a refresh never extends its life. */
export function sessionCookieOptions(iat: number) {
  return {
    httpOnly: true,
    secure: true,
    // Strict: the session cookie is never sent on a request started from
    // another site, which closes cross-site request forgery on every admin
    // action, including the ones that move money.
    sameSite: "strict" as const,
    path: "/",
    maxAge: Math.max(0, SESSION_MAX_AGE_S - (Math.floor(Date.now() / 1000) - iat)),
  };
}

/** The signed-in admin's email, or null. */
export async function sessionEmail(cookie: string | undefined): Promise<string | null> {
  return (await sessionInfo(cookie))?.email ?? null;
}

export async function isValidSession(cookie: string | undefined): Promise<boolean> {
  return (await sessionInfo(cookie)) !== null;
}
