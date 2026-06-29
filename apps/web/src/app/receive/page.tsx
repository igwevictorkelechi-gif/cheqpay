"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, Copy, Check } from "lucide-react";
import { api } from "@/services/api";

const META: Record<string, { name: string; bg: string; glyph: string }> = {
  BTC: { name: "Bitcoin", bg: "#F7931A", glyph: "₿" },
  USDT: { name: "Tether (TRC-20)", bg: "#26A17B", glyph: "₮" },
};

export default function ReceivePage() {
  const router = useRouter();
  const [wallets, setWallets] = useState<{ asset: string; network: string; address: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        await api.ensureProvisioned();
        const { wallets } = await api.getWallets();
        setWallets(wallets);
      } catch {
        setError("Please log in to view your deposit addresses.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function copy(addr: string) {
    navigator.clipboard?.writeText(addr);
    setCopied(addr);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <div className="flex min-h-screen w-full justify-center bg-black">
      <div className="relative min-h-screen w-full max-w-[480px] bg-surface px-5 pb-10 pt-4">
        <button
          onClick={() => router.back()}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-card text-ink active:scale-95"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>

        <h1 className="mt-5 text-3xl font-extrabold text-ink">Receive crypto</h1>
        <p className="mt-1 text-sm text-muted">
          Send only the matching asset to each address. Deposits are credited after
          network confirmations.
        </p>

        {error ? (
          <div className="mt-10 text-center">
            <p className="text-muted">{error}</p>
            <button
              onClick={() => router.push("/login")}
              className="mt-4 rounded-full bg-gradient-to-r from-brand to-brand-light px-6 py-3 font-semibold text-white"
            >
              Go to login
            </button>
          </div>
        ) : loading ? (
          <p className="mt-10 text-center text-sm text-muted">Loading addresses…</p>
        ) : (
          <div className="mt-6 space-y-4">
            {wallets.map((w) => {
              const m = META[w.asset] ?? { name: w.asset, bg: "#6B5B95", glyph: w.asset[0] };
              return (
                <div key={`${w.asset}-${w.network}`} className="rounded-3xl border border-border bg-card p-5">
                  <div className="flex items-center gap-3">
                    <span
                      className="flex h-11 w-11 items-center justify-center rounded-full text-xl font-bold text-white"
                      style={{ backgroundColor: m.bg }}
                    >
                      {m.glyph}
                    </span>
                    <div>
                      <p className="text-lg font-bold text-ink">{w.asset}</p>
                      <p className="text-sm text-muted">{m.name}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => copy(w.address)}
                    className="mt-4 flex w-full items-center justify-between gap-3 rounded-xl bg-surface px-4 py-3 text-left active:scale-[0.99]"
                  >
                    <span className="break-all text-sm text-ink">{w.address}</span>
                    {copied === w.address ? (
                      <Check className="h-5 w-5 shrink-0 text-[#34C759]" />
                    ) : (
                      <Copy className="h-5 w-5 shrink-0 text-muted" />
                    )}
                  </button>
                  <p className="mt-2 text-xs text-muted">
                    {copied === w.address ? "Copied!" : "Tap to copy address"}
                  </p>
                </div>
              );
            })}
            {wallets.length === 0 && (
              <p className="text-center text-sm text-muted">No wallets provisioned yet.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
