"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Gift, Loader2 } from "lucide-react";
import AppShell from "@/components/AppShell";
import { Card } from "@/components/MobileUI";
import { api, ApiError, type GiftCardTrade, type GiftCardTradeStatus } from "@/services/api";

const STATUS: Record<GiftCardTradeStatus, { label: string; color: string }> = {
  SUBMITTED: { label: "Submitted", color: "#6B5B95" },
  IN_REVIEW: { label: "Reviewing", color: "#F5A623" },
  APPROVED: { label: "Paid", color: "#16A34A" },
  REJECTED: { label: "Not accepted", color: "#EF4444" },
};

export default function GiftCardTradesPage() {
  const router = useRouter();
  const [trades, setTrades] = useState<GiftCardTrade[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getGiftCardTrades()
      .then(({ trades }) => setTrades(trades))
      .catch((e) => {
        setError(e instanceof ApiError ? e.message : "Couldn't load your trades.");
        setTrades([]);
      });
  }, []);

  return (
    <AppShell>
      <div className="px-5 pt-4">
        <button onClick={() => router.push("/gift-cards")} className="flex h-11 w-11 items-center justify-center rounded-full bg-card text-ink" aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </button>
      </div>
      <h1 className="mb-5 mt-3 px-5 text-2xl font-extrabold text-ink">My gift card trades</h1>

      {trades === null ? (
        <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>
      ) : error ? (
        <div className="px-5"><Card><p className="py-6 text-center text-sm text-muted">{error}</p></Card></div>
      ) : trades.length === 0 ? (
        <div className="px-5">
          <Card>
            <div className="py-8 text-center">
              <Gift className="mx-auto h-10 w-10 text-muted" />
              <p className="mt-3 text-sm text-muted">No trades yet.</p>
              <button onClick={() => router.push("/gift-cards")} className="mt-4 rounded-full bg-brand px-8 py-3 text-sm font-bold text-white">
                Sell a gift card
              </button>
            </div>
          </Card>
        </div>
      ) : (
        <div className="space-y-3 px-5 pb-10">
          {trades.map((t) => {
            const s = STATUS[t.status];
            return (
              <Card key={t.id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-bold text-ink">{t.brandName} · {t.faceValueFormatted}</p>
                    <p className="mt-0.5 text-xs text-muted">
                      {t.countryName} · {t.cardType === "ECODE" ? "E-code" : "Physical"} ·{" "}
                      {new Date(t.createdAt).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" })}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full px-3 py-1 text-xs font-bold" style={{ background: `${s.color}22`, color: s.color }}>
                    {s.label}
                  </span>
                </div>
                <div className="mt-3 flex items-center justify-between border-t border-border pt-3 text-sm">
                  <span className="text-muted">{t.status === "APPROVED" ? "Paid to your balance" : t.status === "REJECTED" ? "Payout" : "You'll get"}</span>
                  <span className={`font-extrabold ${t.status === "REJECTED" ? "text-muted line-through" : "text-ink"}`}>{t.payoutFormatted}</span>
                </div>
                {t.status === "REJECTED" && t.rejectReason && (
                  <p className="mt-2 rounded-2xl bg-red-500/10 px-3 py-2 text-xs text-red-400">{t.rejectReason}</p>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}
