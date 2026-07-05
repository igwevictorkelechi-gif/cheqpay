// Per-admin session auth for the dashboard. Admins sign in with their own
// Supabase credentials; only emails on the ADMIN_EMAILS allowlist are granted a
// session. The session cookie is bound to the admin's email and signed with a
// server-only secret (HMAC), so it can be verified statelessly in both Edge
// middleware and Node route handlers and can't be forged. Uses Web Crypto,
// available in both runtimes.

export const SESSION_COOKIE = "cheqpay_admin";

/** Secret used to sign the session. Falls back to the API secret if set. */
export function adminSecret(): string {
  return process.env.ADMIN_DASHBOARD_SECRET || process.env.ADMIN_API_SECRET || "";
}

/** Allowlisted admin emails (lowercased). */
export function adminEmails(): Set<string> {
  return new Set(
    (process.env.ADMIN_EMAILS || "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  );
}

export function isAllowedEmail(email: string): boolean {
  return adminEmails().has(email.trim().toLowerCase());
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

/** Build the signed session cookie value for an authenticated admin email. */
export async function sessionCookieValue(email: string): Promise<string> {
  const e = email.trim().toLowerCase();
  const sig = await hmacHex(adminSecret(), `session:${e}`);
  return `${b64urlEncode(e)}.${sig}`;
}

/**
 * Validate a session cookie and return the admin email it belongs to, or null.
 * Re-checks the allowlist so removing an email revokes access immediately.
 */
export async function sessionEmail(cookie: string | undefined): Promise<string | null> {
  const secret = adminSecret();
  if (!cookie || !secret) return null;
  const dot = cookie.indexOf(".");
  if (dot <= 0) return null;
  let email: string;
  try {
    email = b64urlDecode(cookie.slice(0, dot));
  } catch {
    return null;
  }
  const sig = cookie.slice(dot + 1);
  const expected = await hmacHex(secret, `session:${email}`);
  if (!timingSafeEqual(sig, expected)) return null;
  if (!isAllowedEmail(email)) return null;
  return email;
}

export async function isValidSession(cookie: string | undefined): Promise<boolean> {
  return (await sessionEmail(cookie)) !== null;
}
