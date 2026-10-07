'use client';

import { useEffect, useState } from 'react';
import { ExternalLink, Loader2, Megaphone } from 'lucide-react';
import DashboardLayout from '@/components/DashboardLayout';

interface Targeting {
  states: string[];
  radius: { lat: number; lng: number; km: number } | null;
  ageMin: number;
  ageMax: number;
  segments: string[];
  platforms: string[];
  newUsersOnly: boolean;
  dayparts: string[];
  frequencyCap: number;
}
interface Campaign {
  id: string;
  businessName: string;
  headline: string;
  body: string;
  image: string;
  linkUrl: string | null;
  cta: string;
  categoryLabel: string;
  targeting: Targeting;
  startDay: string;
  endDay: string;
  days: number;
  status: 'PENDING_REVIEW' | 'APPROVED' | 'LIVE' | 'ENDED' | 'REJECTED' | 'CANCELLED';
  reason: string | null;
  placements: string[];
  breakdown: { channel: string; label: string; totalFormatted: string }[];
  paidFormatted: string;
  refundedFormatted: string;
  createdAt: string;
  advertiserEmail: string | null;
  advertiserName: string | null;
  stats: { views: number; clicks: number };
}

const FILTERS = ['PENDING_REVIEW', 'LIVE', 'APPROVED', 'ENDED', 'REJECTED', 'CANCELLED', 'ALL'] as const;
const LABEL: Record<string, string> = { PENDING_REVIEW: 'To review', LIVE: 'Live', APPROVED: 'Approved', ENDED: 'Finished', REJECTED: 'Rejected', CANCELLED: 'Stopped', ALL: 'All' };
const PLACEMENT: Record<string, string> = { home: 'Home banner', receipt: 'After a transaction', paybills: 'Pay bills' };
const BADGE: Record<Campaign['status'], string> = {
  PENDING_REVIEW: 'bg-amber-100 text-amber-700',
  APPROVED: 'bg-sky-100 text-sky-700',
  LIVE: 'bg-green-100 text-green-700',
  ENDED: 'bg-gray-100 text-gray-600',
  REJECTED: 'bg-red-100 text-red-700',
  CANCELLED: 'bg-gray-100 text-gray-600',
};

function targetingSummary(t: Targeting): string {
  const parts = [
    t.states.length ? t.states.join(', ') : 'Anywhere',
    t.radius ? `within ${t.radius.km} km of ${t.radius.lat.toFixed(3)}, ${t.radius.lng.toFixed(3)}` : null,
    `age ${t.ageMin}–${t.ageMax}`,
    t.segments.length ? `interests: ${t.segments.join(', ')}` : null,
    t.platforms.length ? `on ${t.platforms.join('/')}` : null,
    t.dayparts.length ? `${t.dayparts.join('/')} only` : null,
    t.newUsersOnly ? 'new users only' : null,
    `max ${t.frequencyCap}/day each`,
  ];
  return parts.filter(Boolean).join(' · ');
}

/**
 * Every ad is reviewed before anyone sees it. Approve (it goes live on its
 * start date) or reject with a reason the advertiser sees — rejection refunds
 * them in full. Both ask for your authenticator code.
 */
export default function AdCampaignsPage() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('PENDING_REVIEW');
  const [list, setList] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/ads/campaigns?status=${filter}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load');
      setList(data.campaigns);
    } catch (e) {
      setMessage({ kind: 'err', text: e instanceof Error ? e.message : 'Failed to load' });
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  async function decide(c: Campaign, approve: boolean) {
    setBusy(c.id);
    setMessage(null);
    try {
      const res = await fetch(`/api/ads/campaigns/${c.id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(approve ? { approve } : { approve, reason: reasons[c.id] ?? '' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed');
      setMessage({ kind: 'ok', text: approve ? `Approved — "${c.headline}" ${data.campaign?.status === 'LIVE' ? 'is live now' : `goes live on ${c.startDay}`}.` : `Rejected and refunded ${c.paidFormatted}.` });
      await load();
    } catch (e) {
      setMessage({ kind: 'err', text: e instanceof Error ? e.message : 'Failed' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <DashboardLayout>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Ad campaigns</h1>
        <p className="mt-2 text-gray-600">Check each ad is honest, legal and suitable before it reaches users. Turn ads on under Features → CheqPay Ads.</p>
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`rounded-full px-4 py-2 text-sm font-semibold ${filter === f ? 'bg-brand-600 text-white' : 'border border-gray-200 bg-white text-gray-700'}`}>
            {LABEL[f]}
          </button>
        ))}
      </div>
      {message && <p className={`mb-4 rounded-lg px-4 py-3 text-sm ${message.kind === 'ok' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`}>{message.text}</p>}

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
      ) : list.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white py-16 text-center text-gray-500"><Megaphone className="mx-auto mb-2 h-8 w-8" />Nothing here.</div>
      ) : (
        <div className="space-y-4">
          {list.map((c) => (
            <div key={c.id} className="grid gap-5 rounded-xl border border-gray-200 bg-white p-5 shadow-sm lg:grid-cols-[360px_1fr]">
              <div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={c.image} alt="" className="aspect-[1.91/1] w-full rounded-lg border border-gray-100 object-cover" />
                <p className="mt-3 font-semibold text-gray-900">{c.headline}</p>
                {c.body && <p className="text-sm text-gray-600">{c.body}</p>}
                {c.linkUrl && (
                  <a href={c.linkUrl} target="_blank" rel="noreferrer noopener" className="mt-1 inline-flex items-center gap-1 break-all text-sm text-brand-600 hover:underline">
                    [{c.cta}] {c.linkUrl} <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                )}
              </div>
              <div className="space-y-3 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-lg font-semibold text-gray-900">{c.businessName}</p>
                    <p className="text-gray-500">{c.advertiserName ?? '—'} · {c.advertiserEmail ?? '—'}</p>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${BADGE[c.status]}`}>{LABEL[c.status] ?? c.status}</span>
                </div>
                <p><span className="text-gray-500">Category:</span> {c.categoryLabel}</p>
                <p><span className="text-gray-500">Where:</span> {c.breakdown.length ? c.breakdown.map((b) => b.label).join(', ') : c.placements.map((p) => PLACEMENT[p] ?? p).join(', ')}</p>
                <p><span className="text-gray-500">When:</span> {c.startDay} → {c.endDay} ({c.days} day{c.days === 1 ? '' : 's'})</p>
                <p><span className="text-gray-500">Who:</span> {targetingSummary(c.targeting)}</p>
                <p><span className="text-gray-500">Paid:</span> {c.paidFormatted}{c.refundedFormatted && !/^₦0(\.00)?$/.test(c.refundedFormatted) ? ` · refunded ${c.refundedFormatted}` : ''}</p>
                {(c.stats.views > 0 || c.status === 'LIVE') && <p><span className="text-gray-500">Results:</span> {c.stats.views.toLocaleString()} views · {c.stats.clicks.toLocaleString()} taps</p>}
                {c.reason && <p className="text-red-700">Reason: {c.reason}</p>}
                {c.status === 'PENDING_REVIEW' && (
                  <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
                    <input
                      value={reasons[c.id] ?? ''}
                      onChange={(e) => setReasons({ ...reasons, [c.id]: e.target.value })}
                      placeholder="Reason if rejecting (the advertiser sees this)"
                      className="min-w-[240px] flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    />
                    <button onClick={() => decide(c, false)} disabled={busy === c.id || (reasons[c.id] ?? '').trim().length < 3} className="rounded-lg border border-red-300 px-4 py-2 text-sm font-semibold text-red-700 disabled:opacity-40">
                      Reject & refund
                    </button>
                    <button onClick={() => decide(c, true)} disabled={busy === c.id} className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
                      Approve
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </DashboardLayout>
  );
}
