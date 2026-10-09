'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, Loader2, Megaphone, Search } from 'lucide-react';
import DashboardLayout from '@/components/DashboardLayout';
import { STATUS_STYLE, socialLine, type ApplicationSummary } from './applications/shared';

const FILTERS = ['PENDING', 'NEEDS_INFO', 'APPROVED', 'REJECTED', 'ALL'] as const;
const LABEL: Record<(typeof FILTERS)[number], string> = {
  PENDING: 'To review',
  NEEDS_INFO: 'Waiting on creator',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  ALL: 'All',
};

/**
 * Creator applications from influencer.mycheqpay.com. Open one to vet the
 * person behind it and approve, ask for more, or reject.
 */
export default function ApplicationsPage() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('PENDING');
  const [q, setQ] = useState('');
  const [apps, setApps] = useState<ApplicationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const t = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/referrals/applications?${new URLSearchParams({ status: filter, q })}`, { cache: 'no-store' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? 'Failed to load');
        if (live) setApps(data.applications);
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        if (live) setLoading(false);
      }
    }, q ? 250 : 0);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [filter, q]);

  return (
    <DashboardLayout>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Creator applications</h1>
        <p className="mt-2 text-gray-600">From influencer.mycheqpay.com. Turn the program on under Features → Referrals &amp; influencers.</p>
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`rounded-full px-4 py-2 text-sm font-semibold ${filter === f ? 'bg-brand-600 text-white' : 'border border-gray-200 bg-white text-gray-700'}`}>
            {LABEL[f]}
          </button>
        ))}
        <label className="relative ml-auto">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, email, handle or code" className="w-72 rounded-full border border-gray-300 py-2 pl-9 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
        </label>
      </div>
      {error && <p className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
      ) : apps.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white py-16 text-center text-gray-500"><Megaphone className="mx-auto mb-2 h-8 w-8" />Nothing here.</div>
      ) : (
        <div className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          {apps.map((a) => (
            <Link key={a.id} href={`/referrals/applications/${a.id}`} className="flex items-center gap-4 p-5 hover:bg-gray-50">
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-gray-900">{a.fullName} <span className="font-normal text-gray-500">· {a.email}</span></p>
                <p className="mt-1 truncate text-sm text-gray-600">{a.socials.map(socialLine).join(' · ')}</p>
                <p className="mt-1 text-xs text-gray-500">
                  {a.niches.join(', ') || '—'} · {a.audienceLocation || '—'} · KYC tier {a.kycTier} · {a.submissions > 1 ? `sent ${a.submissions}× · ` : ''}updated {new Date(a.updatedAt).toLocaleDateString()}
                </p>
              </div>
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLE[a.status]}`}>{LABEL[a.status as keyof typeof LABEL] ?? a.status}</span>
              <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />
            </Link>
          ))}
        </div>
      )}
    </DashboardLayout>
  );
}
