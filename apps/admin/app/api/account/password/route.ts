import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { API_URL } from "@/lib/apiUrl";
import { adminHeaders } from "@/lib/backend";
import { SESSION_COOKIE, sessionCookieOptions, sessionCookieValue, sessionInfo } from "@/lib/adminAuth";

export const dynamic = "force-dynamic";

/**
 * A sub admin replaces their own password. On success the session cookie is
 * re-issued without the "must change password" flag, so the rest of the
 * dashboard they're allowed opens up without signing in again.
 */
export async function PATCH(req: Request) {
  const body = await req.text();
  const res = await fetch(`${API_URL}/api/admin/me/password`, {
    method: "PATCH",
    headers: await adminHeaders({ "Content-Type": "application/json" }),
    body,
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({ error: "Bad response from API" }));
  const out = NextResponse.json(data, { status: res.status });

  if (res.ok) {
    const session = await sessionInfo((await cookies()).get(SESSION_COOKIE)?.value);
    if (session) {
      // Keep the original expiry (changing a password doesn't extend a session)
      // and the sections they already have.
      out.cookies.set(
        SESSION_COOKIE,
        await sessionCookieValue(session.email, session.role, session.epoch, session.iat, false, session.sections),
        sessionCookieOptions(session.iat),
      );
    }
  }
  return out;
}
