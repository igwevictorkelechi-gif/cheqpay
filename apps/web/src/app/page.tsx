"use client";

import { useEffect, useState } from "react";
import Landing from "@/components/Landing";
import Dashboard from "@/components/Dashboard";
import { hasStoredSession } from "@/lib/session";

/**
 * The front door, and the single most valuable URL on the domain.
 *
 * It serves two audiences from one static file. A visitor with no account gets
 * the landing page; somebody signed in gets their dashboard.
 *
 * Why it is built this way: the site ships as a static export, so `/` is one
 * prerendered HTML file that cannot vary by session. Whatever this component
 * renders when `window` is absent IS the HTML that Google receives. It used to
 * render the dashboard behind AuthGuard, which meant the prerendered output was
 * an empty `<div>` and the real content only appeared after a client-side
 * redirect to /welcome — so the homepage had literally nothing to index.
 *
 * Rendering the landing as the server/unauthenticated branch puts the whole
 * marketing page into out/index.html, and signed-in users swap to the dashboard
 * on hydration.
 *
 * The swap happens in an effect rather than during render on purpose: reading
 * localStorage while rendering would disagree with the prerendered HTML and
 * produce a hydration mismatch. A signed-in user therefore sees the landing for
 * one frame — which is still strictly better than the blank screen that was
 * there before.
 */
export default function HomePage() {
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    setSignedIn(hasStoredSession());
  }, []);

  return signedIn ? <Dashboard /> : <Landing />;
}
