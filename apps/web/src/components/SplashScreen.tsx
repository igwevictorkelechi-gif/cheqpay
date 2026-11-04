"use client";

import { useEffect, useState } from "react";
import BrandLogo from "./BrandLogo";

/**
 * Brand splash shown on app launch: the CheqPay logo on the app background,
 * fading out once the app is up. Shown once per browser session (a cold load or
 * reload), not on in-app navigation — the layout mounts once, so it doesn't
 * re-appear as you move between screens.
 *
 * Installed app only. In a browser tab it used to cover the prerendered page
 * from first paint until the JavaScript had downloaded and hydrated, and then
 * hold for another 1.3 s — so a visitor on a slow connection stared at a logo
 * while the landing page was already sitting underneath, fully rendered. That
 * read as "the website loads slowly". CSS (.splash-pwa in globals.css) now
 * hides it unless the page runs in display-mode standalone, so browser
 * visitors see content at first paint, and the installed app keeps its
 * branded launch with a much shorter hold.
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
    const hold = setTimeout(() => setLeaving(true), 250);
    const done = setTimeout(() => setVisible(false), 600);
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
        "splash-pwa fixed inset-0 z-[100] items-center justify-center bg-surface transition-opacity duration-300 " +
        (leaving ? "pointer-events-none opacity-0" : "opacity-100")
      }
    >
      <div className="flex flex-col items-center">
        <BrandLogo className="h-auto w-[190px]" priority />
      </div>
    </div>
  );
}
