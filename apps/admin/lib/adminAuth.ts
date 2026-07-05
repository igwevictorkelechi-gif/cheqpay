// Stateless session auth for the admin dashboard. The session cookie holds an
// HMAC of a fixed payload keyed by a server-only secret, so it can be verified
// in Edge middleware and Node route handlers without a shared session store,
// and can't be forged without the secret. Uses Web Crypto (available in both
// the Edge and Node runtimes).

export const SESSION_COOKIE = "cheqpay_admin";
const PAYLOAD = "cheqpay-admin-session-v1";

/** Secret used to sign the session. Falls back to the API secret if set. */
export function adminSecret(): string {
  return process.env.ADMIN_DASHBOARD_SECRET || process.env.ADMIN_API_SECRET || "";
}

/** The dashboard login password. When unset, the dashboard is locked (fail-closed). */
export function adminPassword(): string {
  return process.env.ADMIN_DASHBOARD_PASSWORD || "";
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

/** The value a valid session cookie must hold. Empty string when unconfigured. */
export async function expectedSessionToken(): Promise<string> {
  const secret = adminSecret();
  if (!secret) return "";
  return hmacHex(secret, PAYLOAD);
}

/** Constant-time string comparison. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

/** Validate a cookie value against the expected session token. */
export async function isValidSession(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const expected = await expectedSessionToken();
  return !!expected && timingSafeEqual(token, expected);
}
