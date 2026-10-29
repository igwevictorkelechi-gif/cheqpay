import { createHmac, timingSafeEqual } from "node:crypto";
import { getEnv } from "./env";
import { WEB_ORIGIN } from "./referrals";

/**
 * QR pay links: `https://mycheqpay.com/pay?u=<username>&c=<token>`.
 *
 * The username is a query param, not a path segment, so the web pay page is a
 * single static route that works even on the static-export (cPanel) build —
 * a `/pay/[username]` segment can't be statically exported for arbitrary names.
 *
 * The token binds a link to one username. The public pay endpoint
 * (`/api/pay/[username]`) returns an account number only when the token checks
 * out, so a shared link or QR resolves fine while the endpoint CANNOT be used
 * to walk usernames and harvest account numbers + names. The token is
 * deterministic from a server secret, so the owner's link is stable and the
 * server can re-derive it to validate — nothing is stored.
 */

/**
 * The signing key, derived (domain-separated) from an existing server secret so
 * pay links work with no extra configuration in any environment. A dedicated
 * PAY_LINK_SECRET takes precedence when set. The `"pay-link-v1"` label keeps
 * this key distinct from the secret's other uses (JWT/admin/cron), so a leak of
 * a pay token tells an attacker nothing about those.
 */
function signingKey(): Buffer {
  const env = getEnv();
  const base =
    env.PAY_LINK_SECRET ||
    env.SUPABASE_JWT_SECRET ||
    env.ADMIN_API_SECRET ||
    env.CRON_SECRET ||
    "cheqpay-pay-link-development-secret";
  return createHmac("sha256", base).update("pay-link-v1").digest();
}

function normalize(username: string): string {
  return username.trim().replace(/^@+/, "").toLowerCase();
}

/** A short, URL-safe token that ties a pay link to this username. */
export function payToken(username: string): string {
  return createHmac("sha256", signingKey()).update(normalize(username)).digest("base64url").slice(0, 16);
}

/** Constant-time check that `token` is the one issued for `username`. */
export function payTokenValid(username: string, token: string | null | undefined): boolean {
  if (!token) return false;
  const expected = payToken(username);
  if (token.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}

/** The https pay link a user shares or encodes in their QR. */
export function payLink(username: string): string {
  const u = username.trim().replace(/^@+/, "");
  return `${WEB_ORIGIN}/pay?u=${encodeURIComponent(u)}&c=${payToken(u)}`;
}
