import { jwtVerify } from "jose";
import { getEnv } from "./env";
import { AuthError, ForbiddenError } from "./http";

export interface AuthUser {
  id: string;
  email?: string;
  phone?: string;
  role?: string;
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

  return {
    id: String(payload.sub),
    email: typeof payload.email === "string" ? payload.email : undefined,
    phone: typeof payload.phone === "string" ? payload.phone : undefined,
    role: typeof payload.role === "string" ? payload.role : undefined,
  };
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
 * Interim admin guard: a shared secret in the `x-admin-secret` header, until
 * full admin auth lands. Compared in constant time.
 */
export function requireAdmin(req: Request): void {
  const expected = getEnv().ADMIN_API_SECRET;
  if (!expected) {
    throw new ForbiddenError("Admin API is not configured");
  }
  const provided = req.headers.get("x-admin-secret") ?? "";
  if (!constantTimeEqual(provided, expected)) {
    throw new ForbiddenError("Invalid admin credentials");
  }
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
