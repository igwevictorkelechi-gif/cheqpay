"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";
import { useInstallGuideStore } from "@/store";
import {
  detectIosInstall,
  guideDue,
  GUIDE_KEY,
  isStandalone,
  quietPath,
  type ArrowSpot,
  type IosInstallInfo,
} from "@/lib/iosInstall";

/**
 * "Add CheqPay to your Home Screen", for iPhone and iPad.
 *
 * iOS gives a web page no install prompt to call, so this walks the visitor
 * through the browser's own menu: a numbered list of what to tap, drawn with
 * the same icons iOS shows, and a bouncing arrow aimed at where the first tap
 * goes (which differs between Safari versions, iPad, other browsers and the
 * in-app browsers of Instagram, WhatsApp and the like — see lib/iosInstall).
 *
 * Opens by itself once, a moment after the first visit, and again a week
 * after "Not now". Profile → "Install the app" reopens it any time.
 */
export default function IosInstallGuide() {
  const open = useInstallGuideStore((s) => s.open);
  const setOpen = useInstallGuideStore((s) => s.setOpen);
  const pathname = usePathname() || "/";
  const [guide, setGuide] = useState<IosInstallInfo | null>(null);

  useEffect(() => {
    if (isStandalone()) return;
    setGuide(
      detectIosInstall({ userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints }),
    );
  }, []);

  // First visit: open on its own after a short pause, never mid sign-in.
  useEffect(() => {
    if (!guide || quietPath(pathname)) return;
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(GUIDE_KEY);
    } catch {
      /* private mode: treat as a first visit */
    }
    if (!guideDue(stored)) return;
    const t = window.setTimeout(() => setOpen(true), 2000);
    return () => window.clearTimeout(t);
  }, [guide, pathname, setOpen]);

  function close(answer: "done" | "later") {
    setOpen(false);
    try {
      localStorage.setItem(GUIDE_KEY, answer === "done" ? "done" : `later:${Date.now()}`);
    } catch {
      /* ignore */
    }
  }

  if (!open || !guide) return null;

  const where = guide.device === "ipad" ? "iPad" : "iPhone";
  const top = guide.arrow === "top-right";

  return (
    <div
      className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ios-guide-title"
      onClick={() => close("later")}
    >
      <Arrow spot={guide.arrow} />

      <div
        className={`absolute inset-x-0 mx-auto w-[calc(100%-2rem)] max-w-[400px] rounded-3xl border border-border bg-card p-5 shadow-2xl shadow-black/60 ${
          top ? "top-[calc(env(safe-area-inset-top)+7rem)]" : "bottom-[calc(env(safe-area-inset-bottom)+7.5rem)]"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={() => close("later")}
          aria-label="Close"
          className="tap absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-circle text-muted"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex items-center gap-3 pr-8">
          <Image src="/cheqpay-icon.png" alt="" width={48} height={48} className="h-12 w-12 shrink-0 rounded-xl" />
          <div>
            <h2 id="ios-guide-title" className="text-lg font-extrabold leading-tight text-ink">
              Install CheqPay on your {where}
            </h2>
            <p className="mt-0.5 text-sm text-muted">
              {guide.browser === "inapp"
                ? "This app’s browser can’t install it. Open CheqPay in Safari first."
                : "Opens full screen from your Home Screen, like any app."}
            </p>
          </div>
        </div>

        <ol className="mt-5 space-y-3">
          {guide.steps.map((s, i) => (
            <li key={i} className="flex items-center gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-bold text-white">
                {i + 1}
              </span>
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-circle text-[#0A84FF]">
                <StepIcon name={s.icon} />
              </span>
              <span className="text-[15px] leading-snug text-ink">
                {s.text} <b className="font-bold">{s.bold}</b>
              </span>
            </li>
          ))}
        </ol>

        <div className="mt-5 flex gap-2">
          <button onClick={() => close("later")} className="btn-secondary min-h-[44px] flex-1">
            Not now
          </button>
          <button onClick={() => close("done")} className="btn-primary min-h-[44px] flex-1">
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}

/** The bouncing arrow at the spot the first tap goes. */
function Arrow({ spot }: { spot: ArrowSpot }) {
  const pos: Record<ArrowSpot, string> = {
    "bottom-center": "bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] left-1/2 -translate-x-1/2",
    "bottom-right": "bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] right-4",
    "top-right": "top-[calc(env(safe-area-inset-top)+0.75rem)] right-4",
  };
  const up = spot === "top-right";
  return (
    <div className={`pointer-events-none absolute ${pos[spot]}`} aria-hidden="true">
      <div className={`${up ? "animate-guide-up" : "animate-guide-down"} motion-reduce:animate-none`}>
        <svg width="56" height="88" viewBox="0 0 56 88" className={up ? "rotate-180" : ""}>
          <path d="M28 4v68" stroke="white" strokeWidth="6" strokeLinecap="round" />
          <path d="M8 54l20 22 20-22" fill="none" stroke="white" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  );
}

/** The icons iOS itself shows for each step, so the guide matches the screen. */
function StepIcon({ name }: { name: IosInstallInfo["steps"][number]["icon"] }) {
  const common = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (name) {
    case "share":
      return (
        <svg {...common}>
          <path d="M12 3v12" />
          <path d="M8 7l4-4 4 4" />
          <path d="M7 10H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-1" />
        </svg>
      );
    case "add":
      return (
        <svg {...common}>
          <rect x="3.5" y="3.5" width="17" height="17" rx="4" />
          <path d="M12 8v8M8 12h8" />
        </svg>
      );
    case "more":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <circle cx="8" cy="12" r="0.9" fill="currentColor" />
          <circle cx="12" cy="12" r="0.9" fill="currentColor" />
          <circle cx="16" cy="12" r="0.9" fill="currentColor" />
        </svg>
      );
    case "safari":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M15.5 8.5l-2.2 4.8-4.8 2.2 2.2-4.8z" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      );
  }
}
