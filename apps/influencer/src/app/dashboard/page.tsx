"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Copy, Check, Loader2, MousePointerClick, UserPlus, BadgeCheck, TrendingUp } from "lucide-react";
import Shell from "@/components/Shell";
import { api, ApiError, type Dashboard } from "@/lib/api";

function Bars({ data, pick, color }: { data: Dashboard["series"]; pick: (d: Dashboard["series"][number]) => number; color: string }) {
  const max = Math.max(1, ...data.map(pick));
  return (
    <div className="flex h-28 items-end gap-[3px]">
      {data.map((d) => (
        <div key={d.day} className="group relative flex-1">
          <div className="w-full rounded-t-[3px]" style={{ height: `${Math.max(3, (pick(d) / max) * 112)}px`, background: pick(d) ? color : "#2E2A3D" }} />
          <span className="pointer-events-none absolute -top-7 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-black px-2 py-0.5 text-[10px] group-hover:block">
            {d.day.slice(5)}: {pick(d)}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function DashboardPage() {
  const [d, setD] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.dashboard().then(setD).catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load your dashboard."));
  }, []);

  return (
    <Shell>
      {!d ? (
        error ? <p className="card text-center text-muted">{error}</p> : <div className="flex justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>
      ) : (
        <div className="space-y-5">
          {!d.active && <p className="rounded-2xl bg-amber-500/10 px-4 py-3 text-sm text-amber-300">Your link is paused. Contact support@mycheqpay.com.</p>}
          <div className="flex flex-col justify-between gap-4 rounded-3xl bg-gradient-to-br from-brand to-[#8f7fc0] p-6 md:flex-row md:items-center">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.25em] text-white/70">Your code</p>
              <p className="mt-1 font-mono text-4xl font-extrabold tracking-wider">{d.code}</p>
              <p className="mt-2 text-sm text-white/80">
                You earn <b>{d.commissionPercent}%</b> of CheqPay&apos;s fees on your referrals&apos; transactions
                {d.windowDays ? ` for ${d.windowDays} days after they join.` : ", for as long as they use CheqPay."}
              </p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => { void navigator.clipboard.writeText(d.link); setCopied(true); setTimeout(() => setCopied(false), 1500); }} className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 font-bold text-brand">
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied ? "Copied" : "Copy link"}
              </button>
              <Link href="/link" className="inline-flex items-center rounded-full bg-white/15 px-5 py-3 font-bold">Share kit</Link>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              { Icon: MousePointerClick, label: "Link clicks", value: d.clicks.toLocaleString() },
              { Icon: UserPlus, label: "Sign-ups", value: d.counts.signedUp.toLocaleString() },
              { Icon: BadgeCheck, label: "Qualified", value: d.counts.qualified.toLocaleString() },
              { Icon: TrendingUp, label: "Their volume", value: d.volumeFormatted },
            ].map(({ Icon, label, value }) => (
              <div key={label} className="card">
                <Icon className="h-5 w-5 text-gold" />
                <p className={`mt-3 break-words font-extrabold md:text-2xl ${value.length > 13 ? "text-sm tracking-tight" : value.length > 10 ? "text-lg" : "text-xl"}`}>{value}</p>
                <p className="text-sm text-muted">{label}</p>
              </div>
            ))}
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            {[
              ["This month", d.totals.thisMonthFormatted],
              ["On hold", d.totals.heldFormatted],
              ["Paid to your balance", d.totals.paidFormatted],
            ].map(([l, v]) => (
              <div key={l} className="card">
                <p className="text-sm text-muted">{l}</p>
                <p className="mt-1 text-2xl font-extrabold text-gold">{v}</p>
              </div>
            ))}
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="card">
              <p className="mb-4 font-bold">Clicks · last 30 days</p>
              <Bars data={d.series} pick={(x) => x.clicks} color="#8A7BB5" />
            </div>
            <div className="card">
              <p className="mb-4 font-bold">Sign-ups · last 30 days</p>
              <Bars data={d.series} pick={(x) => x.signups} color="#F5C97B" />
            </div>
          </div>
          <p className="text-center text-xs text-muted">Commission is counted when your referrals&apos; transactions complete, held for a short time to protect against fraud, then paid into your CheqPay balance.</p>
        </div>
      )}
    </Shell>
  );
}
