import { jwtVerify } from "jose";
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

/**
 * Verify a Supabase-issued JWT (HS256, signed with the project's JWT secret).
 * Returns the authenticated user claims, or throws AuthError.
 *
 * `secret` is injectable for tests; defaults to SUPABASE_JWT_SECRET.
 */
export async function verifySupabaseJwt(
  token: string,
  secret?: string
): Promise<AuthUser> {
  const s = secret ?? getEnv().SUPABASE_JWT_SECRET;
  if (!s) {
    throw new AuthError("Auth is not configured (SUPABASE_JWT_SECRET missing)");
  }

  let payload;
  try {
    ({ payload } = await jwtVerify(token, new TextEncoder().encode(s), {
      algorithms: ["HS256"],
    }));
  } catch {
    throw new AuthError("Invalid or expired token");
  }

  if (!payload.sub) {
    throw new AuthError("Invalid token: missing subject");
  }

  const appMeta = (payload.app_metadata ?? {}) as { role?: unknown };

  return {
    id: String(payload.sub),
    email: typeof payload.email === "string" ? payload.email : undefined,
    phone: typeof payload.phone === "string" ? payload.phone : undefined,
    role: typeof payload.role === "string" ? payload.role : undefined,
    aal: typeof payload.aal === "string" ? payload.aal : undefined,
    isAdmin: appMeta.role === "admin",
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
