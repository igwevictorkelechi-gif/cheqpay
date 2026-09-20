import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  SESSION_COOKIE,
  isSuperOnlyApi,
  isSuperOnlyPage,
  sessionInfo,
} from "@/lib/adminAuth";

// Gate every page and API proxy route behind a valid admin session. The login
// page and the auth endpoint are the only public routes. Fail-closed: without a
// valid session, pages redirect to /login and API routes return 401 — so the
// server-held ADMIN_API_SECRET is never usable by an unauthenticated visitor.
//
// Super-Admin-only areas (roles, provider/payment settings, adjust balance,
// feature toggles) are additionally gated by role. Because the backend is only
// reachable through these signed-cookie-guarded proxies, blocking a regular
// admin here genuinely denies access, not just the menu item.
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

  // Signed in, but role-gated areas are Super-Admin-only.
  if (session.role !== "super") {
    if (isSuperOnlyApi(pathname)) {
      return NextResponse.json(
        { error: "This action requires a Super Admin." },
        { status: 403 },
      );
    }
    if (isSuperOnlyPage(pathname)) {
      const url = req.nextUrl.clone();
      url.pathname = "/dashboard";
      url.search = "?denied=1";
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

// Run on everything except Next internals and static icons.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|manifest).*)"],
};
