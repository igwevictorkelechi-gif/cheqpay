import { NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  adminSecret,
  sessionCookieOptions,
  sessionCookieValue,
  sessionInfo,
} from "@/lib/adminAuth";
import { cleanSections } from "@/lib/adminSections";
import { API_URL } from "@/lib/apiUrl";
import { adminHeaders } from "@/lib/backend";

export const dynamic = "force-dynamic";

/** Log in with the admin dashboard credentials (verified by the backend). */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const email = String(body?.email ?? "").trim().toLowerCase();
  const password = String(body?.password ?? "");
  const otp = String(body?.otp ?? "").replace(/\D/g, "").slice(0, 6);

  // The person's real address, for the backend's rate limit, blocklist and
  // audit — the backend itself only sees this server.
  const clientIp =
    req.headers.get("x-real-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "";

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
    headers: {
      "Content-Type": "application/json",
      // The service secret is what lets the API trust the forwarded address.
      ...(process.env.ADMIN_API_SECRET ? { "x-admin-secret": process.env.ADMIN_API_SECRET } : {}),
      ...(clientIp ? { "x-admin-client-ip": clientIp } : {}),
    },
    body: JSON.stringify({ email, password, ...(otp ? { otp } : {}) }),
    cache: "no-store",
  }).catch(() => null);

  if (!verify || !verify.ok) {
    const detail = verify
      ? ((await verify.json().catch(() => ({}))) as { error?: string; code?: string })
      : {};
    const status = verify?.status ?? 502;
    // The second step: password was right, now the authenticator code. Passed
    // through so the login page can ask for it.
    if (detail.code === "otp_required" || detail.code === "bad_otp") {
      return NextResponse.json({ error: detail.error, code: detail.code }, { status: 401 });
    }
    if (status === 429 || status === 403) {
      return NextResponse.json({ error: detail.error ?? "Sign-in blocked", code: detail.code }, { status });
    }
    return NextResponse.json(
      { error: status === 401 ? "Invalid email or password" : "Login is temporarily unavailable" },
      { status: status === 401 ? 401 : 502 }
    );
  }
  const data = (await verify.json().catch(() => ({}))) as {
    email?: string;
    role?: string;
    mustChangePassword?: boolean;
    epoch?: string;
    otpConfigured?: boolean;
    sections?: unknown;
  };
  if (!data.epoch) {
    // A backend too old to hand out an epoch cannot revoke sessions; refuse
    // rather than mint one that could never be signed out.
    return NextResponse.json({ error: "Login is temporarily unavailable" }, { status: 502 });
  }
  const authedEmail = (data.email ?? email).toLowerCase();
  // The backend decides the role: the main login is a Super Admin, a sub
  // admin's own login is not. Anything unexpected gets the least privilege.
  const role = data.role === "super" ? "super" : "admin";
  const mustChangePassword = role !== "super" && data.mustChangePassword === true;
  const sections = role === "super" ? [] : cleanSections(data.sections);

  const res = NextResponse.json({
    ok: true,
    email: authedEmail,
    role,
    mustChangePassword,
    otpConfigured: !!data.otpConfigured,
  });
  const iat = Math.floor(Date.now() / 1000);
  res.cookies.set(
    SESSION_COOKIE,
    await sessionCookieValue(authedEmail, role, data.epoch, iat, mustChangePassword, sections),
    sessionCookieOptions(iat),
  );
  return res;
}

/**
 * The signed-in admin (for the UI), or nulls.
 *
 * For a sub admin this also refreshes the session from the backend: the
 * sections a Super Admin has granted or removed since sign-in, and whether the
 * password still has to be changed. When they differ from the cookie it is
 * re-signed in place (same issue time, so it never lives longer), which is how
 * a newly granted section appears without signing in again.
 */
export async function GET(req: Request) {
  const cookie = req.headers
    .get("cookie")
    ?.split("; ")
    .find((c) => c.startsWith(`${SESSION_COOKIE}=`))
    ?.split("=")
    .slice(1)
    .join("=");
  const info = await sessionInfo(cookie);
  if (!info) return NextResponse.json({ email: null, role: null, mustChangePassword: false, sections: [] });
  if (info.role === "super") {
    return NextResponse.json({ email: info.email, role: "super", mustChangePassword: false, sections: [], otpEnrolled: true });
  }

  const me = await fetch(`${API_URL}/api/admin/me`, { headers: await adminHeaders(), cache: "no-store" }).catch(() => null);
  if (!me?.ok) {
    // Removed or revoked: say so, so the page goes to sign-in. A backend that is
    // merely unreachable leaves the session as it is.
    const body = me ? ((await me.json().catch(() => ({}))) as { code?: string }) : {};
    if (me?.status === 401) {
      const out = NextResponse.json({ email: null, role: null, mustChangePassword: false, sections: [], code: body.code }, { status: 401 });
      out.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
      return out;
    }
    return NextResponse.json({
      email: info.email,
      role: info.role,
      mustChangePassword: info.mustChangePassword,
      sections: info.sections,
    });
  }
  const d = (await me.json().catch(() => ({}))) as { sections?: unknown; mustChangePassword?: boolean; otpEnrolled?: boolean };
  const sections = cleanSections(d.sections);
  const mustChangePassword = d.mustChangePassword === true;
  const out = NextResponse.json({
    email: info.email,
    role: "admin",
    mustChangePassword,
    sections,
    otpEnrolled: d.otpEnrolled === true,
  });
  if (mustChangePassword !== info.mustChangePassword || sections.join(",") !== info.sections.join(",")) {
    out.cookies.set(
      SESSION_COOKIE,
      await sessionCookieValue(info.email, info.role, info.epoch, info.iat, mustChangePassword, sections),
      sessionCookieOptions(info.iat),
    );
  }
  return out;
}

/** Log out — clear the session cookie. */
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
