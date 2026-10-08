'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ChevronRight, Code2, Loader2 } from 'lucide-react';
import DashboardLayout from '@/components/DashboardLayout';
import { dollars, naira } from '@/lib/devFormat';

interface Row {
  id: string;
  public_id: string;
  business_name: string;
  legal_name: string | null;
  rc_number: string | null;
  status: 'sandbox' | 'pending_review' | 'approved' | 'rejected' | 'suspended';
  frozen: boolean;
  submitted_at: string | null;
  created_at: string;
  owner_email: string;
  plan_id: string | null;
  subscription_status: string | null;
  live_balance: { NGN: number; USD: number };
}
interface Recon {
  live_totals: { NGN: number; USD: number };
  mismatches: { wallet_id: string; account_id: string; currency: string; balance: number; ledger_sum: number }[];
}

const FILTERS = ['pending_review', 'approved', 'sandbox', 'rejected', 'suspended', 'all'] as const;
const LABEL: Record<string, string> = {
  pending_review: 'To review',
  approved: 'Live',
  sandbox: 'Sandbox',
  rejected: 'Rejected',
  suspended: 'Suspended',
  all: 'All',
};
const BADGE: Record<Row['status'], string> = {
  pending_review: 'bg-amber-100 text-amber-700',
  approved: 'bg-green-100 text-green-700',
  sandbox: 'bg-gray-100 text-gray-600',
  rejected: 'bg-red-100 text-red-700',
  suspended: 'bg-red-100 text-red-700',
};

/**
 * Businesses building on the CheqPay API. Anyone can open a sandbox; live
 * access needs an application you approve here, then a paid plan.
 */
export default function DevelopersPage() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('pending_review');
  const [rows, setRows] = useState<Row[]>([]);
  const [recon, setRecon] = useState<Recon | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/developers${filter === 'all' ? '' : `?status=${filter}`}`, { cache: 'no-store' })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? 'Failed to load');
        setRows(d.accounts);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [filter]);

  useEffect(() => {
    fetch('/api/developers/reconciliation', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setRecon(d))
      .catch(() => undefined);
  }, []);

  return (
    <DashboardLayout>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Developers</h1>
        <p className="mt-2 text-gray-600">
          Businesses using the CheqPay API. Approve only businesses you have verified: approval opens live money movement. Turn the API on under Features → Developer API.
        </p>
      </div>

      {recon && (
        <div className="mb-6 grid gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-sm text-gray-500">Developer money held (live, NGN)</p>
            <p className="mt-1 text-2xl font-semibold text-gray-900">{naira(recon.live_totals.NGN)}</p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-sm text-gray-500">Developer money held (live, USD)</p>
            <p className="mt-1 text-2xl font-semibold text-gray-900">{dollars(recon.live_totals.USD)}</p>
          </div>
          <div className={`rounded-xl border p-4 ${recon.mismatches.length ? 'border-red-300 bg-red-50' : 'border-gray-200 bg-white'}`}>
            <p className="text-sm text-gray-500">Ledger check</p>
            {recon.mismatches.length ? (
              <p className="mt-1 flex items-center gap-2 font-semibold text-red-700">
                <AlertTriangle className="h-5 w-5" /> {recon.mismatches.length} wallet{recon.mismatches.length === 1 ? '' : 's'} don’t match their entries (frozen)
              </p>
            ) : (
              <p className="mt-1 text-2xl font-semibold text-green-700">All balances proven</p>
            )}
          </div>
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full px-4 py-2 text-sm font-semibold ${filter === f ? 'bg-brand-600 text-white' : 'border border-gray-200 bg-white text-gray-700'}`}
          >
            {LABEL[f]}
          </button>
        ))}
      </div>
      {error && <p className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white py-16 text-center text-gray-500">
          <Code2 className="mx-auto mb-2 h-8 w-8" />
          Nothing here.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          {rows.map((r) => (
            <Link key={r.id} href={`/developers/${r.id}`} className="flex items-center gap-4 border-b border-gray-100 px-5 py-4 last:border-0 hover:bg-gray-50">
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-gray-900">
                  {r.legal_name ?? r.business_name}
                  {r.frozen && <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">Frozen</span>}
                </p>
                <p className="truncate text-sm text-gray-500">
                  {r.owner_email}
                  {r.rc_number ? ` · ${r.rc_number}` : ''}
                  {r.plan_id ? ` · ${r.plan_id} (${r.subscription_status})` : ''}
                </p>
              </div>
              <div className="hidden text-right text-sm text-gray-600 md:block">
                <p>{naira(r.live_balance.NGN)}</p>
                <p>{dollars(r.live_balance.USD)}</p>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${BADGE[r.status]}`}>{LABEL[r.status === 'approved' ? 'approved' : r.status]}</span>
              <ChevronRight className="h-4 w-4 text-gray-400" />
            </Link>
          ))}
        </div>
      )}
    </DashboardLayout>
  );
}
