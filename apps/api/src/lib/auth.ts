import { decodeJwt } from "jose";
import { getEnv } from "./env";
import { AuthError, ForbiddenError } from "./http";

export interface AuthUser {
  id: string;
  email?: string;
  phone?: string;
  role?: string;
  /** Supabase assurance level: "aal1" (password/OTP) or "aal2" (MFA verified). */
  aal?: string;
  /** True when app_metadata.role === "admin". */
  isAdmin?: boolean;
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
    app_metadata?: { role?: unknown };
  };
  if (!u.id) {
    throw new AuthError("Invalid token: no user");
  }

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
    aal,
    isAdmin: u.app_metadata?.role === "admin",
  };
}

/** True if the authenticated user is an admin (role claim or email allowlist). */
export function isAdminUser(user: AuthUser): boolean {
  if (user.isAdmin) return true;
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
  return verifySupabaseJwt(token);
}

/**
 * Admin guard. Accepts either:
 *   1. a trusted service secret in `x-admin-secret` (backend-to-backend, e.g.
 *      the admin dashboard proxy), or
 *   2. an authenticated admin user (Supabase role "admin" or email allowlist).
 */
export async function requireAdmin(req: Request): Promise<void> {
  // Path 1: service secret.
  const expected = getEnv().ADMIN_API_SECRET;
  const provided = req.headers.get("x-admin-secret");
  if (expected && provided && constantTimeEqual(provided, expected)) {
    return;
  }
  // Path 2: admin user JWT.
  const auth = await requireUser(req);
  if (isAdminUser(auth)) {
    return;
  }
  throw new ForbiddenError("Admin privileges required");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
