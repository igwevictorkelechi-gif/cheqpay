"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import { api, getAccessToken } from "@/services/api";

const rows: { key: string; title: string; subtitle: string }[] = [
  { key: "deposits", title: "Deposits", subtitle: "When money lands in your wallet" },
  { key: "withdrawals", title: "Withdrawals", subtitle: "Status updates on your payouts" },
  { key: "trades", title: "Buy, sell & convert", subtitle: "Confirmations for crypto trades" },
  { key: "bills", title: "Bill payments", subtitle: "Airtime, data, electricity & more" },
  { key: "price", title: "Price alerts", subtitle: "Big moves on BTC and USDT" },
  { key: "security", title: "Security alerts", subtitle: "New logins and sensitive changes" },
  { key: "promos", title: "Product & promotions", subtitle: "News, tips and special offers" },
];

export default function NotificationsPage() {
  const router = useRouter();
  const [prefs, setPrefs] = useState<Record<string, boolean> | null>(null);

  useEffect(() => {
    (async () => {
      try {
        if (!(await getAccessToken())) return;
        const { preferences } = await api.getNotificationPrefs();
        setPrefs(preferences);
      } catch {
        /* leave loading */
      }
    })();
  }, []);

  const flip = async (key: string) => {
    if (!prefs) return;
    const next = !prefs[key];
    setPrefs({ ...prefs, [key]: next });
    try {
      await api.updateNotificationPrefs({ [key]: next });
    } catch {
      setPrefs((p) => (p ? { ...p, [key]: !next } : p));
    }
  };

  return (
    <div className="flex min-h-screen justify-center bg-black">
      <div className="relative flex min-h-screen w-full max-w-[480px] flex-col bg-surface px-5 pb-8 pt-3">
        <button
          onClick={() => router.back()}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-card text-ink"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>

        <h1 className="mt-6 text-4xl font-extrabold text-ink">Notifications</h1>
        <p className="mb-4 mt-2 text-sm text-muted">
          Choose what CheqPay lets you know about.
        </p>

        {!prefs ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-brand" />
          </div>
        ) : (
          <div className="rounded-3xl bg-card px-4">
            {rows.map((r, i) => (
              <div
                key={r.key}
                className={`flex items-center py-4 ${i > 0 ? "border-t border-border" : ""}`}
              >
                <div className="flex-1 pr-3">
                  <p className="text-base font-semibold text-ink">{r.title}</p>
                  <p className="mt-0.5 text-xs text-muted">{r.subtitle}</p>
                </div>
                <button
                  onClick={() => flip(r.key)}
                  aria-pressed={!!prefs[r.key]}
                  className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors ${
                    prefs[r.key] ? "bg-brand" : "bg-circle"
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                      prefs[r.key] ? "translate-x-6" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
