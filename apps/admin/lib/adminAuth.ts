// Per-admin session auth for the dashboard. Admins sign in with their own
// Supabase credentials; only emails on the ADMIN_EMAILS allowlist are granted a
// session. The session cookie is bound to the admin's email and signed with a
// server-only secret (HMAC), so it can be verified statelessly in both Edge
// middleware and Node route handlers and can't be forged. Uses Web Crypto,
// available in both runtimes.

export const SESSION_COOKIE = "cheqpay_admin";

export type AdminRole = "admin" | "super";

export interface SessionInfo {
  email: string;
  role: AdminRole;
  /** Unix seconds the session was minted. */
  iat: number;
  /** Backend session epoch at sign-in; rotating it revokes this session. */
  epoch: string;
}

/**
 * Hard lifetime of an admin session, enforced on the SIGNED issue time — not
 * just the cookie's maxAge, which is only a hint to the browser. A copied
 * cookie value used to be valid forever; now it dies after this long however it
 * is replayed, and sooner if the epoch is rotated.
 */
export const SESSION_MAX_AGE_S = 60 * 60 * 8;

// Areas only Super Admins may reach. Enforced in middleware for both the page
// and the API proxy behind it (the backend is only reachable through these
// proxies, which hold the shared secret — so blocking here is real, not just
// cosmetic). Matched by prefix, so "/features" also covers "/features/popup".
export const SUPER_ONLY_PAGE_PREFIXES = [
  "/roles",
  "/provider-settings",
  "/payment-settings",
  "/provider-check",
  "/adjust-balance",
  "/features",
];

export const SUPER_ONLY_API_PREFIXES = [
  "/api/roles",
  "/api/provider-status",
  "/api/provider-check",
  "/api/adjust-balance",
  "/api/admin-otp",
  "/api/features",
  "/api/popup",
];

export function isSuperOnlyPage(pathname: string): boolean {
  return SUPER_ONLY_PAGE_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );
}

export function isSuperOnlyApi(pathname: string): boolean {
  return SUPER_ONLY_API_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );
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
 * Format (v2):
 *   b64url(email).b64url(role).iat.b64url(epoch).hmac(`session:v2:${email}:${role}:${iat}:${epoch}`)
 *
 * Everything that decides what the session may do — who, which role, when it
 * was issued, which epoch — is under the signature, so none of it can be edited
 * client-side. The role is still trusted in Edge middleware without a database
 * round-trip; the epoch is checked by the backend on every call.
 */
export async function sessionCookieValue(
  email: string,
  role: AdminRole,
  epoch: string,
  iat: number = Math.floor(Date.now() / 1000),
): Promise<string> {
  const e = email.trim().toLowerCase();
  const sig = await hmacHex(adminSecret(), `session:v2:${e}:${role}:${iat}:${epoch}`);
  return `${b64urlEncode(e)}.${b64urlEncode(role)}.${iat}.${b64urlEncode(epoch)}.${sig}`;
}

/**
 * Validate a session cookie and return its contents, or null.
 *
 * Only the v2 format is accepted. Every session minted before it — including
 * any copied out of a browser during the 22 Sep incident — fails here, which
 * signs everyone out once when this ships.
 */
export async function sessionInfo(cookie: string | undefined): Promise<SessionInfo | null> {
  const secret = adminSecret();
  if (!cookie || !secret) return null;
  const parts = cookie.split(".");
  if (parts.length !== 5) return null;
  let email: string;
  let role: string;
  let epoch: string;
  try {
    email = b64urlDecode(parts[0]);
    role = b64urlDecode(parts[1]);
    epoch = b64urlDecode(parts[3]);
  } catch {
    return null;
  }
  if (!/^\d{9,11}$/.test(parts[2])) return null;
  const iat = Number(parts[2]);

  const expected = await hmacHex(secret, `session:v2:${email}:${role}:${iat}:${epoch}`);
  if (!timingSafeEqual(parts[4], expected)) return null;

  const now = Math.floor(Date.now() / 1000);
  if (iat > now + 60) return null; // issued in the future: not ours
  if (now - iat > SESSION_MAX_AGE_S) return null; // expired, however it is replayed

  return { email, role: role === "super" ? "super" : "admin", iat, epoch };
}

/** The signed-in admin's email, or null. */
export async function sessionEmail(cookie: string | undefined): Promise<string | null> {
  return (await sessionInfo(cookie))?.email ?? null;
}

export async function isValidSession(cookie: string | undefined): Promise<boolean> {
  return (await sessionInfo(cookie)) !== null;
}
