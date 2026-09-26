import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  SESSION_COOKIE,
  SUB_ADMIN_PASSWORD_PAGE,
  sessionInfo,
  subAdminAccess,
} from "@/lib/adminAuth";

// Gate every page and API proxy route behind a valid admin session. The login
// page and the auth endpoint are the only public routes. Fail-closed: without a
// valid session, pages redirect to /login and API routes return 401 — so the
// server-held ADMIN_API_SECRET is never usable by an unauthenticated visitor.
//
// Sub admins are additionally limited to the Dashboard and Analytics.
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname === "/login" || pathname === "/api/auth") {
    return NextResponse.next();
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await sessionInfo(token);

  if (!session) {
    if (pathname.startsWith("/api")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }

  // Super Admins reach everything. Sub admins reach only the Dashboard and
  // Analytics (and, until they've replaced their starting password, only the
  // page that does that). Because the backend is only reachable through these
  // signed-cookie-guarded proxies — and checks the same list itself — this
  // genuinely denies access, not just the menu item.
  if (session.role !== "super") {
    const decision = subAdminAccess(pathname, req.method, session.mustChangePassword);
    if (decision !== "allow") {
      if (pathname.startsWith("/api")) {
        return NextResponse.json(
          {
            error:
              decision === "change_password"
                ? "Set your own password first."
                : "Sub admins can only view the Dashboard and Analytics.",
          },
          { status: 403 },
        );
      }
      const url = req.nextUrl.clone();
      url.pathname = decision === "change_password" ? SUB_ADMIN_PASSWORD_PAGE : "/dashboard";
      url.search = decision === "change_password" ? "" : "?denied=1";
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

// Run on everything except Next internals and static icons.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|manifest).*)"],
};
