"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff, Loader2 } from "lucide-react";
import { disablePush, enablePush, isPushEnabled, pushSupport, type PushSupport } from "@/lib/webPush";

/** Turn this browser's notifications on or off, with a plain answer for each case. */
export default function BrowserNotificationsCard() {
  const [support, setSupport] = useState<PushSupport | null>(null);
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    const s = pushSupport();
    setSupport(s);
    if (s === "granted") void isPushEnabled().then(setOn).catch(() => undefined);
  }, []);

  const toggle = async () => {
    setBusy(true);
    setMsg(null);
    try {
      if (on) {
        await disablePush();
        setOn(false);
      } else {
        const result = await enablePush();
        setSupport(result);
        setOn(result === "granted");
        if (result === "denied") setMsg("Notifications are blocked for this site in your browser settings.");
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Couldn't change browser notifications.");
    } finally {
      setBusy(false);
    }
  };

  if (support === null) return null;

  const note =
    support === "unsupported"
      ? "This browser can't show notifications. Try Chrome, Edge, Firefox or Safari."
      : support === "ios-needs-install"
        ? "On iPhone, first add CheqPay to your Home Screen (Share → Add to Home Screen), then turn notifications on from there."
        : support === "denied"
          ? "Notifications are blocked for this site. Allow them in your browser's site settings, then come back."
          : on
            ? "This browser will show CheqPay notifications, even when the tab is closed."
            : "Get alerts in this browser for deposits, withdrawals and security, even when the tab is closed.";

  const canToggle = support === "default" || support === "granted";

  return (
    <div className="mb-4 rounded-3xl bg-card p-4">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand/15 text-brand-light">
          {on ? <Bell className="h-5 w-5" /> : <BellOff className="h-5 w-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-ink">Browser notifications</p>
          <p className="mt-0.5 text-xs text-muted">{note}</p>
        </div>
        {canToggle && (
          <button
            onClick={toggle}
            disabled={busy}
            className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold active:scale-95 disabled:opacity-50 ${
              on ? "bg-circle text-ink" : "bg-brand text-white"
            }`}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : on ? "Turn off" : "Turn on"}
          </button>
        )}
      </div>
      {msg && <p className="mt-2 text-xs text-red-400">{msg}</p>}
    </div>
  );
}
