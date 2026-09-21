"use client";

import { useEffect, useState } from "react";
import BrandLogo from "./BrandLogo";

/**
 * Brand splash shown on app launch: the CheqPay logo on the app background,
 * fading out once the app is up. Shown once per browser session (a cold load or
 * reload), not on in-app navigation — the layout mounts once, so it doesn't
 * re-appear as you move between screens.
 *
 * Rendered visible on the server so it covers the very first paint, then the
 * client fades and unmounts it. The PWA also declares a native splash via the
 * manifest icons + background_color for the installed-app launch; this covers
 * the browser and the moment before hydration everywhere.
 */
const SEEN_KEY = "cheqpay:splash";

export default function SplashScreen() {
  const [visible, setVisible] = useState(true);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    let seen = false;
    try {
      seen = sessionStorage.getItem(SEEN_KEY) === "1";
    } catch {
      /* storage unavailable — just show it */
    }
    if (seen) {
      setVisible(false);
      return;
    }
    try {
      sessionStorage.setItem(SEEN_KEY, "1");
    } catch {
      /* ignore */
    }
    const hold = setTimeout(() => setLeaving(true), 900);
    const done = setTimeout(() => setVisible(false), 1300);
    return () => {
      clearTimeout(hold);
      clearTimeout(done);
    };
  }, []);

  if (!visible) return null;

  return (
    <div
      aria-hidden
      className={
        "fixed inset-0 z-[100] flex items-center justify-center bg-surface transition-opacity duration-300 " +
        (leaving ? "pointer-events-none opacity-0" : "opacity-100")
      }
    >
      <div className="flex flex-col items-center">
        <BrandLogo className="h-auto w-[190px]" priority />
      </div>
    </div>
  );
}
