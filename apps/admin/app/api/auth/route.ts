import { NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  adminSecret,
  isAllowedEmail,
  sessionCookieValue,
  sessionEmail,
} from "@/lib/adminAuth";

export const dynamic = "force-dynamic";

const TWELVE_HOURS = 60 * 60 * 12;

function supabaseConfig() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const anon =
    process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  return { url, anon };
}

/**
 * Log in with an admin's own Supabase email + password. Grants a session only
 * if the credentials are valid AND the email is on the ADMIN_EMAILS allowlist.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const email = String(body?.email ?? "").trim().toLowerCase();
  const password = String(body?.password ?? "");

  const { url, anon } = supabaseConfig();
  // Fail-closed if the server isn't configured to authenticate/sign sessions.
  if (!url || !anon || !adminSecret()) {
    return NextResponse.json(
      { error: "Admin login is not configured on the server." },
      { status: 503 }
    );
  }
  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
  }

  // Verify credentials against Supabase Auth (password grant).
  const auth = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anon, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  }).catch(() => null);

  if (!auth || !auth.ok) {
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }
  const data = (await auth.json().catch(() => ({}))) as { user?: { email?: string } };
  const authedEmail = (data.user?.email ?? email).toLowerCase();

  if (!isAllowedEmail(authedEmail)) {
    return NextResponse.json(
      { error: "This account is not authorized for the admin dashboard." },
      { status: 403 }
    );
  }

  const res = NextResponse.json({ ok: true, email: authedEmail });
  res.cookies.set(SESSION_COOKIE, await sessionCookieValue(authedEmail), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: TWELVE_HOURS,
  });
  return res;
}

/** Return the currently signed-in admin's email (for the header), or null. */
export async function GET(req: Request) {
  const cookie = req.headers
    .get("cookie")
    ?.split("; ")
    .find((c) => c.startsWith(`${SESSION_COOKIE}=`))
    ?.split("=")
    .slice(1)
    .join("=");
  const email = await sessionEmail(cookie);
  return NextResponse.json({ email });
}

/** Log out — clear the session cookie. */
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
