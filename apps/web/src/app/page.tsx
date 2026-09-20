"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Landing from "@/components/Landing";
import { LoadingScreen } from "@/components/Lottie";
import { hasStoredSession } from "@/lib/session";

/**
 * The dashboard is loaded on demand, not bundled into this page.
 *
 * Statically importing it pulled the whole authenticated app — the API client,
 * the Supabase session, the balance and chart components — into the bundle for
 * `/`. That is the URL search traffic lands on, and a first-time visitor who
 * will only ever see the landing page was downloading the entire signed-in
 * experience before the marketing copy could paint. It was ~86 kB of the
 * homepage's weight and none of it reachable for the audience it was served to.
 *
 * Nothing about the prerendered output changes: the server/unauthenticated
 * branch is still <Landing />, so out/index.html still contains the whole
 * marketing page for Google. A signed-in user now fetches one extra chunk on
 * hydration, which is the right side of the trade — they have an account
 * already, and they are the audience that can afford a request.
 */
const Dashboard = dynamic(() => import("@/components/Dashboard"), {
  // ssr:false keeps it out of the prerender entirely, which is also what makes
  // the static export safe — it must never try to render a session at build.
  ssr: false,
  loading: () => <LoadingScreen />,
});

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
