"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/services/supabase";

// Routes reachable without a session.
const PUBLIC_EXACT = new Set(["/login", "/signup", "/verify-otp"]);
const PUBLIC_PREFIX = ["/legal", "/privacy", "/terms", "/about", "/support", "/faq", "/contact"];

/**
 * Strip a trailing slash so "/login" and "/login/" are the same route.
 *
 * They are not the same string, and that mattered: the static export is built
 * with `trailingSlash`, so usePathname() returns "/login/", which failed the
 * exact-match check below. The guard then treated the login page as protected,
 * rendered a blank screen and redirected to /login — which was also "/login/",
 * so it looped. Normalizing here keeps the guard correct whichever way a URL
 * arrives, rather than making it depend on the build config.
 */
function normalize(path: string): string {
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

function isPublic(rawPath: string): boolean {
  const path = normalize(rawPath);
  return (
    PUBLIC_EXACT.has(path) ||
    PUBLIC_PREFIX.some((p) => path === p || path.startsWith(p + "/"))
  );
}

/**
 * Client-side auth gate. Unauthenticated users on a protected route are sent to
 * /login and never see the page; authenticated users are kept off the auth
 * pages. The session lives in the browser (supabase-js), so this can't be done
 * in middleware without SSR cookies.
 */
export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    let active = true;

    const apply = (ok: boolean) => {
      if (!active) return;
      setAuthed(ok);
      setReady(true);
      if (!ok && !isPublic(pathname)) {
        router.replace(`/login?next=${encodeURIComponent(pathname)}`);
      } else if (ok && (pathname === "/login" || pathname === "/signup")) {
        router.replace("/");
      }
    };

    supabase.auth.getSession().then(({ data }) => apply(!!data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) =>
      apply(!!session)
    );
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // On a protected route, render nothing until a session is confirmed — so
  // protected content never flashes for a signed-out visitor.
  if (!isPublic(pathname) && (!ready || !authed)) {
    return <div className="min-h-screen bg-surface" />;
  }
  return <>{children}</>;
}
