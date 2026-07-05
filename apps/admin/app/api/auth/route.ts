import { NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  adminPassword,
  expectedSessionToken,
  timingSafeEqual,
} from "@/lib/adminAuth";

export const dynamic = "force-dynamic";

const TWELVE_HOURS = 60 * 60 * 12;

/** Log in with the dashboard password → set the signed session cookie. */
export async function POST(req: Request) {
  const password = await req
    .json()
    .then((b) => (b?.password as string) ?? "")
    .catch(() => "");

  const expected = adminPassword();
  const token = await expectedSessionToken();

  // Fail-closed: no password or no signing secret configured → nobody gets in.
  if (!expected || !token) {
    return NextResponse.json(
      { error: "Admin login is not configured on the server." },
      { status: 503 }
    );
  }
  if (!password || !timingSafeEqual(password, expected)) {
    return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: TWELVE_HOURS,
  });
  return res;
}

/** Log out — clear the session cookie. */
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
