import { NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  adminSecret,
  sessionCookieValue,
  sessionEmail,
} from "@/lib/adminAuth";

export const dynamic = "force-dynamic";

const API_URL = process.env.CHEQPAY_API_URL ?? "https://cheqpay-admin453.vercel.app";
const TWELVE_HOURS = 60 * 60 * 12;

/** Log in with the admin dashboard credentials (verified by the backend). */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const email = String(body?.email ?? "").trim().toLowerCase();
  const password = String(body?.password ?? "");

  if (!adminSecret()) {
    return NextResponse.json(
      { error: "Admin login is not configured on the server." },
      { status: 503 }
    );
  }
  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
  }

  const verify = await fetch(`${API_URL}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
    cache: "no-store",
  }).catch(() => null);

  if (!verify || !verify.ok) {
    const status = verify?.status === 401 ? 401 : verify?.status ?? 502;
    return NextResponse.json(
      { error: status === 401 ? "Invalid email or password" : "Login is temporarily unavailable" },
      { status }
    );
  }
  const data = (await verify.json().catch(() => ({}))) as { email?: string };
  const authedEmail = (data.email ?? email).toLowerCase();

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
