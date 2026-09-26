import { decodeJwt } from "jose";
import { prisma } from "@cheqpay/db";
import { getEnv } from "./env";
import { ApiError, AuthError, ForbiddenError } from "./http";
import { touchActivity } from "./activity";
import { assertAccessAllowed } from "./accessControl";
import { assertSessionCurrent } from "./adminSession";
import { getSubAdminState } from "./adminCreds";
import { subAdminMayCall } from "./subAdminAccess";

export interface AuthUser {
  id: string;
  email?: string;
  phone?: string;
  /** Full name from Supabase user_metadata (set at signup). */
  fullName?: string;
  role?: string;
  /** Supabase assurance level: "aal1" (password/OTP) or "aal2" (MFA verified). */
  aal?: string;
  /** True when app_metadata.role === "admin". */
  isAdmin?: boolean;
  /** True once Supabase has confirmed the email address. */
  emailConfirmed?: boolean;
}

// Public project identifiers (the anon key ships in the client bundle), used to
// validate user tokens against Supabase. Overridable via env.
const SUPABASE_URL =
  process.env.SUPABASE_URL ??
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  "https://xttgnswgeffyybjfjlkp.supabase.co";
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh0dGduc3dnZWZmeXliamZqbGtwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY0NjIzMzMsImV4cCI6MjA5MjAzODMzM30.RWUrrTINfqPJ_H6vbFtLZ7uf0okWb5gUYJy9LK9NlCQ";

/**
 * Validate a Supabase user access token by asking Supabase to resolve it
 * (`GET /auth/v1/user`). This works regardless of the project's JWT signing
 * method (HS256 secret or asymmetric keys) — no shared secret to misconfigure.
 * The `aal` (MFA level) is read from the token after Supabase confirms it.
 */
export async function verifySupabaseJwt(token: string): Promise<AuthUser> {
  let res: Response;
  try {
    res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY },
    });
  } catch {
    throw new AuthError("Could not reach the auth server");
  }
  if (!res.ok) {
    throw new AuthError("Invalid or expired token");
  }
  const u = (await res.json()) as {
    id?: string;
    email?: string;
    phone?: string;
    email_confirmed_at?: string | null;
    app_metadata?: { role?: unknown };
    user_metadata?: { full_name?: unknown };
  };
  if (!u.id) {
    throw new AuthError("Invalid token: no user");
  }
  const fullName =
    typeof u.user_metadata?.full_name === "string" ? u.user_metadata.full_name : undefined;

  let aal: string | undefined;
  try {
    aal = (decodeJwt(token) as { aal?: string }).aal;
  } catch {
    /* token already validated by Supabase; aal is best-effort */
  }

  return {
    id: u.id,
    email: u.email,
    phone: u.phone,
    fullName,
    aal,
    emailConfirmed: Boolean(u.email_confirmed_at),
    isAdmin: u.app_metadata?.role === "admin",
  };
}

/** True if the authenticated user is an admin (role claim or email allowlist). */
export function isAdminUser(user: AuthUser): boolean {
  if (user.isAdmin) return true;
  // An email only proves identity once it has been confirmed. Otherwise anyone
  // could sign up with an allowlisted address that isn't registered yet.
  if (!user.emailConfirmed) return false;
  const allow = (getEnv().ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return !!user.email && allow.includes(user.email.toLowerCase());
}

/**
 * Require that the caller has completed MFA (Supabase AAL2). Used to gate
 * sensitive actions like crypto withdrawals.
 */
export function requireMfa(user: AuthUser): void {
  if (user.aal !== "aal2") {
    throw new ForbiddenError("Two-factor authentication required");
  }
}

/** Extract + verify the Bearer token from a request. Throws on failure. */
export async function requireUser(req: Request): Promise<AuthUser> {
  const header = req.headers.get("authorization") ?? "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) {
    throw new AuthError("Missing or malformed Authorization header");
  }
  const user = await verifySupabaseJwt(token);

  // Record the IP, device and route for the security history. Placed here so
  // every authenticated route is covered without each one remembering.
  // Fire-and-forget and internally throttled: a security log must never be able
  // to slow down or fail the request it is observing. Recorded BEFORE the block
  // check below, so a blocked account's attempts still show up in its history.
  touchActivity(req, user.id);

  // A valid token is not permission to use the API. Blocked, suspended and
  // closed accounts, and blocklisted addresses, are refused here — for every
  // authenticated route at once. Without this, blocking an account in the admin
  // dashboard changed a label and nothing else.
  await assertAccessAllowed(req, user.id);

  return user;
}

/** True if the email is in the DB-managed admin allowlist (platform_settings). */
async function isSettingsAdmin(email?: string): Promise<boolean> {
  if (!email) return false;
  try {
    const row = await prisma.platformSetting.findUnique({ where: { key: "admin_emails" } });
    if (!row) return false;
    const parsed = JSON.parse(row.value) as unknown;
    return (
      Array.isArray(parsed) &&
      parsed.map((e) => String(e).toLowerCase()).includes(email.toLowerCase())
    );
  } catch {
    return false;
  }
}

/**
 * Admin guard. Accepts either:
 * 1. a trusted service secret in `x-admin-secret` (backend-to-backend, e.g.
 *    the admin dashboard proxy), or
 * 2. an authenticated admin user (Supabase role "admin", env email allowlist,
 *    or the DB-managed admin allowlist).
 */
export async function requireAdmin(req: Request): Promise<void> {
  // Path 1: service secret.
  const expected = getEnv().ADMIN_API_SECRET;
  const provided = req.headers.get("x-admin-secret");
  if (expected && provided && constantTimeEqual(provided, expected)) {
    // The dashboard forwards the epoch its session was minted under. A session
    // from before the last password change / OTP reset / "sign out everywhere"
    // is refused here, on every admin route, not just the sensitive ones.
    await assertSessionCurrent(req);
    await assertSubAdminAllowed(req);
    return;
  }
  // Path 2: admin user JWT (role/env allowlist, then DB allowlist).
  const auth = await requireUser(req);
  if (isAdminUser(auth)) {
    return;
  }
  if (auth.emailConfirmed && (await isSettingsAdmin(auth.email))) {
    return;
  }
  throw new ForbiddenError("Admin privileges required");
}

async function assertSubAdminAllowed(req: Request): Promise<void> {
  const actor = (req.headers.get("x-admin-actor") ?? "").trim().toLowerCase();
  const role = req.headers.get("x-admin-role");
  // Server-to-server calls without a session (sign-in itself) and Super Admins
  // are not limited here.
  if (!actor || role === "super") return;

  const state = await getSubAdminState(actor);
  if (!state.active) {
    // Same code as a revoked session, so the dashboard signs them out at once.
    throw new ApiError(401, "Your admin access has been removed. Please contact the account owner.", "admin_session_revoked");
  }
  const pathname = new URL(req.url).pathname.replace(/\/+$/, "");
  if (!subAdminMayCall(req.method, pathname, state.mustChange)) {
    throw new ForbiddenError(
      state.mustChange
        ? "Set your own password before continuing."
        : "Sub admins can only view the Dashboard and Analytics.",
    );
  }
}

/** True when the request carries the dashboard's service secret. */
export function hasAdminServiceSecret(req: Request): boolean {
  const expected = getEnv().ADMIN_API_SECRET;
  const provided = req.headers.get("x-admin-secret");
  return Boolean(expected && provided && constantTimeEqual(provided, expected));
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
