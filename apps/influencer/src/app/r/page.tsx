"use client";

import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { API_BASE, APP_URL } from "@/lib/api";

/**
 * An influencer's tracking link: influencer.mycheqpay.com/r/CODE (served by an
 * .htaccess rewrite to this one static page) or /r/?c=CODE. Counts the click
 * from the visitor's own browser — so it's per person, not per server — then
 * sends them to sign up with the code filled in, never waiting more than a moment.
 */
export default function TrackingLink() {
  useEffect(() => {
    const fromPath = window.location.pathname.replace(/^\/r\/?/, "").split("/")[0] ?? "";
    const raw = new URLSearchParams(window.location.search).get("c") || decodeURIComponent(fromPath);
    const code = raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);
    const go = () => window.location.replace(code ? `${APP_URL}/signup/?ref=${encodeURIComponent(code)}` : `${APP_URL}/signup/`);
    if (!code) return go();
    const timer = setTimeout(go, 1500);
    fetch(`${API_BASE}/api/referrals/click`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
      keepalive: true,
    })
      .catch(() => undefined)
      .finally(() => {
        clearTimeout(timer);
        go();
      });
  }, []);
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 text-muted">
      <Loader2 className="h-6 w-6 animate-spin" />
      <p className="text-sm">Taking you to CheqPay…</p>
    </div>
  );
}
