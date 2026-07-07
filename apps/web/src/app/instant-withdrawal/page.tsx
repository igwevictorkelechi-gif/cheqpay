"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Zap, Loader2 } from "lucide-react";
import { api, getAccessToken } from "@/services/api";

export default function InstantWithdrawalPage() {
  const router = useRouter();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        if (!(await getAccessToken())) return;
        const me = await api.getMe();
        setEnabled(me.instantWithdrawal);
      } catch {
        setEnabled(false);
      }
    })();
  }, []);

  const toggle = async () => {
    const next = !enabled;
    if (next && !window.confirm(
      "Enable instant withdrawal? Crypto withdrawals will no longer require a 2FA code — faster but less secure."
    )) {
      return;
    }
    setBusy(true);
    const prev = enabled;
    setEnabled(next);
    try {
      await api.setInstantWithdrawal(next);
    } catch {
      setEnabled(prev ?? false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen justify-center bg-black">
      <div className="relative flex min-h-screen w-full max-w-[480px] flex-col bg-surface px-5 pb-10 pt-3">
        <button
          onClick={() => router.back()}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-card text-ink"
          aria-label="Go back"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>

        <span className="mt-6 flex h-16 w-16 items-center justify-center rounded-3xl bg-red-500/15">
          <Zap className="h-7 w-7 text-red-500" />
        </span>

        <h1 className="mb-2 mt-5 text-4xl font-extrabold text-ink">Instant withdrawal</h1>
        <p className="mb-6 text-base text-muted">
          Skip the 2FA step when withdrawing crypto. Convenient, but it lowers your account
          security — only enable this if you understand the risk.
        </p>

        {enabled === null ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-brand" />
          </div>
        ) : (
          <div className="flex items-center justify-between rounded-2xl bg-card p-4">
            <div className="flex-1 pr-3">
              <p className="text-base font-semibold text-ink">Withdraw without 2FA</p>
              <p className="mt-0.5 text-xs text-muted">
                {enabled ? "Enabled — withdrawals skip 2FA" : "Disabled — 2FA required"}
              </p>
            </div>
            <button
              onClick={toggle}
              disabled={busy}
              aria-pressed={enabled}
              className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors ${
                enabled ? "bg-red-500" : "bg-circle"
              }`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                  enabled ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
