"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Eye, Loader2, Megaphone, MousePointerClick, Plus } from "lucide-react";
import AppShell from "@/components/AppShell";
import { Card, useToast } from "@/components/MobileUI";
import { api, ApiError, type AdCampaign } from "@/services/api";

const STATUS: Record<AdCampaign["status"], { label: string; cls: string }> = {
  PENDING_REVIEW: { label: "In review", cls: "bg-amber-500/15 text-amber-400" },
  APPROVED: { label: "Approved · starts soon", cls: "bg-sky-500/15 text-sky-400" },
  LIVE: { label: "Live", cls: "bg-green-500/15 text-green-400" },
  ENDED: { label: "Finished", cls: "bg-circle text-muted" },
  REJECTED: { label: "Not approved", cls: "bg-red-500/15 text-red-400" },
  CANCELLED: { label: "Stopped", cls: "bg-circle text-muted" },
};
const pretty = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-NG", { day: "numeric", month: "short" });

/** The advertiser's campaigns: status, money and results. */
export default function MyCampaignsPage() {
  const router = useRouter();
  const toast = useToast();
  const [list, setList] = useState<AdCampaign[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [fresh, setFresh] = useState(false);

  const load = () =>
    api
      .getMyAdCampaigns()
      .then((r) => setList(r.campaigns))
      .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load your campaigns."));

  useEffect(() => {
    setFresh(new URLSearchParams(window.location.search).has("new"));
    void load();
  }, []);

  async function stop(c: AdCampaign) {
    const live = c.status === "LIVE";
    if (!confirm(live ? "Stop this ad? Today's run is kept; the days left are refunded." : "Cancel this ad? You'll get a full refund.")) return;
    setBusy(c.id);
    try {
      await api.cancelAdCampaign(c.id);
      toast.show("Ad stopped — the refund is in your balance.");
      await load();
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "Couldn't stop it. Try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <AppShell>
      <div className="flex items-center justify-between px-5 pt-4">
        <button onClick={() => router.back()} className="flex h-11 w-11 items-center justify-center rounded-full bg-card text-ink" aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <Link href="/advertise" className="flex items-center gap-1.5 rounded-full bg-brand px-4 py-2.5 text-sm font-bold text-white">
          <Plus className="h-4 w-4" /> New ad
        </Link>
      </div>
      <h1 className="mt-3 px-5 text-2xl font-extrabold text-ink">My campaigns</h1>
      {fresh && (
        <div className="mx-5 mt-3 rounded-2xl bg-green-500/10 px-4 py-3 text-sm text-green-400">
          Paid and sent for review. We&apos;ll notify you as soon as it&apos;s approved.
        </div>
      )}

      <div className="space-y-3 px-5 pb-32 pt-4">
        {!list ? (
          error ? <Card><p className="py-6 text-center text-sm text-muted">{error}</p></Card> : <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>
        ) : list.length === 0 ? (
          <Card>
            <div className="py-8 text-center">
              <Megaphone className="mx-auto h-9 w-9 text-muted" />
              <p className="mt-2 font-bold text-ink">No ads yet</p>
              <p className="mt-1 text-sm text-muted">Put your business in front of people where they pay.</p>
              <Link href="/advertise" className="mt-4 inline-block rounded-full bg-brand px-6 py-3 font-bold text-white">Create an ad</Link>
            </div>
          </Card>
        ) : (
          list.map((c) => {
            const st = STATUS[c.status];
            const ctr = c.stats.views ? ((c.stats.clicks / c.stats.views) * 100).toFixed(1) : "0.0";
            return (
              <Card key={c.id}>
                <div className="flex gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={c.image} alt="" className="h-16 w-28 shrink-0 rounded-xl object-cover" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold text-ink">{c.headline}</p>
                    <p className="text-xs text-muted">{pretty(c.startDay)} → {pretty(c.endDay)} · {c.breakdown.length} place{c.breakdown.length === 1 ? "" : "s"}</p>
                    <span className={`mt-1.5 inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${st.cls}`}>{st.label}</span>
                  </div>
                </div>
                {c.reason && <p className="mt-3 rounded-xl bg-red-500/10 px-3 py-2 text-xs text-red-300">{c.reason}</p>}
                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-2xl bg-circle p-2.5">
                    <p className="flex items-center justify-center gap-1 text-lg font-extrabold text-ink"><Eye className="h-4 w-4 text-muted" />{c.stats.views.toLocaleString("en-NG")}</p>
                    <p className="text-[11px] text-muted">Views</p>
                  </div>
                  <div className="rounded-2xl bg-circle p-2.5">
                    <p className="flex items-center justify-center gap-1 text-lg font-extrabold text-ink"><MousePointerClick className="h-4 w-4 text-muted" />{c.stats.clicks.toLocaleString("en-NG")}</p>
                    <p className="text-[11px] text-muted">Taps</p>
                  </div>
                  <div className="rounded-2xl bg-circle p-2.5">
                    <p className="text-lg font-extrabold text-ink">{ctr}%</p>
                    <p className="text-[11px] text-muted">Tap rate</p>
                  </div>
                </div>
                {c.stats.byChannel.length > 0 && (
                  <div className="mt-3 space-y-1 text-xs">
                    {c.stats.byChannel.map((ch) => (
                      <div key={ch.channel} className="flex justify-between text-muted">
                        <span>{ch.label}</span>
                        <span className="text-ink">{ch.views.toLocaleString("en-NG")} views · {ch.clicks.toLocaleString("en-NG")} taps</span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="mt-3 flex items-center justify-between border-t border-border pt-3 text-xs text-muted">
                  <span>Paid {c.paidFormatted}{c.refundedFormatted !== "₦0" && c.refundedFormatted !== "₦0.00" ? ` · refunded ${c.refundedFormatted}` : ""}</span>
                  {["PENDING_REVIEW", "APPROVED", "LIVE"].includes(c.status) && (
                    <button onClick={() => stop(c)} disabled={busy === c.id} className="font-semibold text-red-400 disabled:opacity-40">
                      {busy === c.id ? "Stopping…" : c.status === "LIVE" ? "Stop ad" : "Cancel"}
                    </button>
                  )}
                </div>
              </Card>
            );
          })
        )}
      </div>
    </AppShell>
  );
}
