"use client";

import { useEffect, useState } from "react";
import { Bell, X } from "lucide-react";
import { enablePush, pushSupport } from "@/lib/webPush";

const DISMISSED_KEY = "cheqpay:push-prompt-dismissed";
const QUIET_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * A small, dismissible "turn on notifications" banner. It never triggers the
 * browser's permission prompt on its own — that happens only when the user
 * taps "Turn on" — and once dismissed it stays away for 30 days.
 */
export default function PushPrompt() {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (pushSupport() !== "default") return;
    let dismissedAt = 0;
    try {
      dismissedAt = Number(localStorage.getItem(DISMISSED_KEY) ?? 0);
    } catch {
      /* storage unavailable */
    }
    if (Date.now() - dismissedAt > QUIET_MS) setShow(true);
  }, []);

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISSED_KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
    setShow(false);
  };

  const turnOn = async () => {
    setBusy(true);
    try {
      await enablePush();
    } catch {
      /* the Notifications page explains any failure */
    } finally {
      setBusy(false);
      dismiss();
    }
  };

  if (!show) return null;
  return (
    <div className="mt-4 flex items-center gap-3 rounded-2xl border border-brand/30 bg-brand/10 p-3">
      <Bell className="h-5 w-5 shrink-0 text-brand-light" />
      <p className="min-w-0 flex-1 text-sm text-ink">
        Get notified when money arrives or leaves your account.
      </p>
      <button
        onClick={turnOn}
        disabled={busy}
        className="shrink-0 rounded-full bg-brand px-3 py-1.5 text-xs font-bold text-white active:scale-95 disabled:opacity-50"
      >
        Turn on
      </button>
      <button onClick={dismiss} aria-label="Not now" className="shrink-0 text-muted">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
