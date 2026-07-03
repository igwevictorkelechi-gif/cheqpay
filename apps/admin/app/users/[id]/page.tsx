'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { ArrowLeft, CheckCircle2, PauseCircle, Ban, ShieldCheck } from 'lucide-react';
import DashboardLayout from '@/components/DashboardLayout';

type UserDetail = {
  user: {
    id: string;
    email: string;
    phone: string;
    status: string;
    kycTier: number;
    kycStatus: string;
    createdAt: string;
  };
  balances: { asset: string; available: string; locked: string }[];
  kycRecords: { id: string; tier: number; status: string; createdAt: string }[];
  transactions: {
    id: string;
    type: string;
    asset: string;
    amount: string;
    status: string;
    reference: string;
    createdAt: string;
  }[];
};

const STATUSES = ['ACTIVE', 'SUSPENDED', 'BLOCKED'] as const;
const TIERS = [0, 1, 2, 3] as const;

function statusColor(status: string): string {
  switch (status.toUpperCase()) {
    case 'ACTIVE':
    case 'COMPLETED':
    case 'APPROVED':
      return 'bg-green-100 text-green-800';
    case 'SUSPENDED':
    case 'PENDING':
    case 'PROCESSING':
      return 'bg-yellow-100 text-yellow-800';
    case 'BLOCKED':
    case 'FAILED':
    case 'REJECTED':
      return 'bg-red-100 text-red-800';
    default:
      return 'bg-gray-100 text-gray-800';
  }
}

function formatAmount(asset: string, value: string): string {
  const n = Number(value);
  if (asset === 'NGN') {
    return `₦${(isFinite(n) ? n : 0).toLocaleString('en-NG', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
  return `${value} ${asset}`;
}

export default function UserDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id as string;

  const [data, setData] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!id) return;
    setLoading(true);
    setError(null);
    fetch(`/api/users/${id}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`Failed to load user (${r.status})`);
        return r.json();
      })
      .then((d: UserDetail) => setData(d))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const patch = useCallback(
    async (payload: { status?: string; kycTier?: number }) => {
      if (!id) return;
      setSaving(true);
      setNotice(null);
      setError(null);
      try {
        const r = await fetch(`/api/users/${id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d?.error || `Update failed (${r.status})`);
        setNotice('Changes saved.');
        load();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setSaving(false);
      }
    },
    [id, load],
  );

  const u = data?.user;

  return (
    <DashboardLayout>
      <div className="mb-6">
        <a
          href="/users"
          className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"
        >
          <ArrowLeft size={16} />
          Back to users
        </a>
      </div>

      {loading && <p className="text-gray-500">Loading…</p>}

      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {!loading && u && (
        <>
          <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">{u.email}</h1>
              <p className="mt-1 text-sm text-gray-500">
                {u.phone} · ID {u.id.slice(0, 8)} · Joined{' '}
                {new Date(u.createdAt).toLocaleDateString()}
              </p>
            </div>
            <span
              className={`inline-flex w-fit rounded-full px-3 py-1 text-sm font-medium ${statusColor(
                u.status,
              )}`}
            >
              {u.status}
            </span>
          </div>

          {notice && (
            <div className="mb-6 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-700">
              {notice}
            </div>
          )}

          <section className="mb-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold text-gray-900">Account status</h2>
            <div className="flex flex-wrap gap-3">
              {STATUSES.map((s) => {
                const active = u.status.toUpperCase() === s;
                const Icon =
                  s === 'ACTIVE' ? CheckCircle2 : s === 'SUSPENDED' ? PauseCircle : Ban;
                return (
                  <button
                    key={s}
                    disabled={active || saving}
                    onClick={() => patch({ status: s })}
                    className={`inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed ${
                      active
                        ? 'border-brand-500 bg-brand-50 text-brand-700'
                        : 'border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50'
                    }`}
                  >
                    <Icon size={16} />
                    {active ? `${s} (current)` : s}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="mb-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <ShieldCheck size={18} className="text-gray-500" />
              <h2 className="text-lg font-semibold text-gray-900">KYC tier</h2>
              <span
                className={`ml-2 rounded-full px-2.5 py-0.5 text-xs font-medium ${statusColor(
                  u.kycStatus,
                )}`}
              >
                {u.kycStatus}
              </span>
            </div>
            <div className="flex flex-wrap gap-3">
              {TIERS.map((t) => {
                const active = u.kycTier === t;
                return (
                  <button
                    key={t}
                    disabled={active || saving}
                    onClick={() => patch({ kycTier: t })}
                    className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed ${
                      active
                        ? 'border-brand-500 bg-brand-50 text-brand-700'
                        : 'border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50'
                    }`}
                  >
                    Tier {t}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="mb-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold text-gray-900">Balances</h2>
            {data.balances.length === 0 ? (
              <p className="text-sm text-gray-500">No balances.</p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-3">
                {data.balances.map((b) => (
                  <div key={b.asset} className="rounded-lg border border-gray-100 bg-gray-50 p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                      {b.asset}
                    </p>
                    <p className="mt-1 text-lg font-semibold text-gray-900">
                      {formatAmount(b.asset, b.available)}
                    </p>
                    <p className="text-xs text-gray-500">Locked: {formatAmount(b.asset, b.locked)}</p>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="mb-6 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900">Recent transactions</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-gray-200 bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Type</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Amount</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Status</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Reference</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {data.transactions.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-6 py-8 text-center text-gray-500">
                        No transactions.
                      </td>
                    </tr>
                  )}
                  {data.transactions.map((t) => (
                    <tr key={t.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 text-sm font-medium text-gray-900">{t.type}</td>
                      <td className="px-6 py-4 text-sm text-gray-900">
                        {formatAmount(t.asset, t.amount)}
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusColor(
                            t.status,
                          )}`}
                        >
                          {t.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">{t.reference}</td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        {new Date(t.createdAt).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </DashboardLayout>
  );
}
