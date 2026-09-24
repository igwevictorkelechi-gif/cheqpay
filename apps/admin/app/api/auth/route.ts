import { NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_S,
  adminSecret,
  sessionCookieValue,
  sessionInfo,
  type AdminRole,
} from "@/lib/adminAuth";
import { API_URL } from "@/lib/apiUrl";

export const dynamic = "force-dynamic";

/**
 * Resolve an admin's role from the backend roles list. Env admins
 * (ADMIN_EMAILS) are always Super Admins; otherwise the DB-managed tier
 * applies. Defaults to the least privilege ("admin") if the list can't be read.
 */
async function resolveRole(email: string): Promise<AdminRole> {
  try {
    const res = await fetch(`${API_URL}/api/admin/roles`, {
      headers: { "x-admin-secret": process.env.ADMIN_API_SECRET ?? "" },
      cache: "no-store",
    });
    if (!res.ok) return "admin";
    const d = (await res.json()) as {
      envAdmins?: unknown;
      admins?: unknown;
    };
    const env = Array.isArray(d.envAdmins)
      ? d.envAdmins.map((e) => String(e).toLowerCase())
      : [];
    if (env.includes(email)) return "super";
    const managed = Array.isArray(d.admins) ? d.admins : [];
    for (const a of managed) {
      if (a && typeof a === "object") {
        const row = a as { email?: unknown; role?: unknown };
        if (String(row.email ?? "").toLowerCase() === email && row.role === "super") {
          return "super";
        }
      }
    }
    return "admin";
  } catch {
    return "admin";
  }
}

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
    epoch?: string;
    otpConfigured?: boolean;
  };
  if (!data.epoch) {
    // A backend too old to hand out an epoch cannot revoke sessions; refuse
    // rather than mint one that could never be signed out.
    return NextResponse.json({ error: "Login is temporarily unavailable" }, { status: 502 });
  }
  const authedEmail = (data.email ?? email).toLowerCase();
  const role = await resolveRole(authedEmail);

  const res = NextResponse.json({ ok: true, email: authedEmail, role, otpConfigured: !!data.otpConfigured });
  res.cookies.set(SESSION_COOKIE, await sessionCookieValue(authedEmail, role, data.epoch), {
    httpOnly: true,
    secure: true,
    // Strict: the session cookie is never sent on a request started from
    // another site, which closes cross-site request forgery on every admin
    // action, including the ones that move money.
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_MAX_AGE_S,
  });
  return res;
}

/** Return the currently signed-in admin's email and role (for the UI), or null. */
export async function GET(req: Request) {
  const cookie = req.headers
    .get("cookie")
    ?.split("; ")
    .find((c) => c.startsWith(`${SESSION_COOKIE}=`))
    ?.split("=")
    .slice(1)
    .join("=");
  const info = await sessionInfo(cookie);
  return NextResponse.json({ email: info?.email ?? null, role: info?.role ?? null });
}

/** Log out — clear the session cookie. */
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
