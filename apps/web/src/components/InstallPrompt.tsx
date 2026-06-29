"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { X, Download, Share } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "cheqpay-install-dismissed";

export default function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [isIOS, setIsIOS] = useState(false);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Already installed (standalone) → never show.
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true;
    if (standalone) return;

    // Respect a previous dismissal.
    try {
      if (localStorage.getItem(DISMISS_KEY)) return;
    } catch {
      /* ignore */
    }

    const ua = navigator.userAgent || "";
    const ios = /iphone|ipad|ipod/i.test(ua);
    if (ios) {
      setIsIOS(true);
      setShow(true);
      return;
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setShow(true);
    };
    window.addEventListener("beforeinstallprompt", handler);

    const installed = () => setShow(false);
    window.addEventListener("appinstalled", installed);

    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("appinstalled", installed);
    };
  }, []);

  function dismiss() {
    setShow(false);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
  }

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice.catch(() => undefined);
    setDeferred(null);
    setShow(false);
  }

  if (!show) return null;

  return (
    <div className="fixed inset-x-0 bottom-24 z-[60] mx-auto flex max-w-[440px] justify-center px-4">
      <div className="flex w-full items-center gap-3 rounded-2xl border border-border bg-card/95 p-3 shadow-2xl shadow-black/50 backdrop-blur-xl">
        <Image
          src="/cheqpay-icon.png"
          alt="CheqPay"
          width={44}
          height={44}
          className="h-11 w-11 shrink-0 rounded-xl"
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-ink">Install CheqPay</p>
          {isIOS ? (
            <p className="mt-0.5 flex items-center gap-1 text-xs text-muted">
              Tap <Share className="inline h-3 w-3" /> then “Add to Home Screen”
            </p>
          ) : (
            <p className="mt-0.5 text-xs text-muted">Add it to your home screen for quick access.</p>
          )}
        </div>

        {!isIOS && (
          <button
            onClick={install}
            className="flex shrink-0 items-center gap-1.5 rounded-full bg-gradient-to-r from-brand to-brand-light px-4 py-2 text-sm font-bold text-white active:scale-95"
          >
            <Download className="h-4 w-4" />
            Install
          </button>
        )}
        <button
          onClick={dismiss}
          aria-label="Dismiss"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted active:scale-95"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
