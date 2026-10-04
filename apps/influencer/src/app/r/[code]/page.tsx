"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { API_BASE, APP_URL } from "@/lib/api";

/**
 * An influencer's tracking link. Counts the click from the visitor's own
 * browser (so it's per person, not per server), then sends them to sign up
 * with the code filled in. The redirect never waits more than a moment.
 */
export default function TrackingLink() {
  const { code } = useParams<{ code: string }>();
  useEffect(() => {
    const clean = String(code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);
    const go = () => window.location.replace(`${APP_URL}/signup/?ref=${encodeURIComponent(clean)}`);
    const timer = setTimeout(go, 1500);
    fetch(`${API_BASE}/api/referrals/click`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: clean }),
      keepalive: true,
    })
      .catch(() => undefined)
      .finally(() => {
        clearTimeout(timer);
        go();
      });
  }, [code]);
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 text-muted">
      <Loader2 className="h-6 w-6 animate-spin" />
      <p className="text-sm">Taking you to CheqPay…</p>
    </div>
  );
}
