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
  kyc: {
    legalName: string | null;
    dateOfBirth: string | null;
    email: string | null;
    phone: string | null;
    address: {
      street: string | null;
      city: string | null;
      state: string | null;
      postalCode: string | null;
    };
    bvnLast4: string | null;
    idDocType: string | null;
    idDocNumberLast4: string | null;
    mapleradCustomerId: string | null;
    mapleradTier: number;
    submittedAt: string | null;
    documents: { front: string | null; back: string | null };
  };
  activity: {
    lastSeenAt: string | null;
    lastIp: string | null;
    lastDevice: string | null;
    lastAction: string | null;
    lastTransactionIp: string | null;
    lastTransactionAt: string | null;
    devices: {
      id: string;
      ipAddress: string | null;
      device: string | null;
      platform: string;
      userAgent: string | null;
      hitCount: number;
      firstSeenAt: string;
      lastSeenAt: string;
    }[];
  };
  stats: {
    byType: { type: string; asset: string; count: number; total: string }[];
    lifecycle: {
      accountAgeDays: number;
      firstTransactionAt: string | null;
      lastTransactionAt: string | null;
      daysSinceLastActivity: number | null;
      totalTransactions: number;
      completedTransactions: number;
      failedTransactions: number;
    };
    risk: {
      deviceCount: number;
      distinctIpCount: number;
      failedRate: number;
      kycSubmissionCount: number;
      kycTier: number;
      providerEnrolled: boolean;
      depositAccountNumber: string | null;
    };
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
    ip: string | null;
    createdAt: string;
  }[];
};

/** Anything not captured shows a dash rather than an empty cell. */
const DASH = '—';
function show(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === '') return DASH;
  return String(v);
}

function formatDateTime(iso: string | null): string {
  if (!iso) return DASH;
  return new Date(iso).toLocaleString();
}

const ID_TYPE_LABELS: Record<string, string> = {
  NIN: 'NIN',
  PASSPORT: 'International passport',
  VOTERS_CARD: "Voter's card",
  DRIVERS_LICENSE: "Driver's licence",
};

/** One label/value pair in a definition grid. */
function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className="mt-1 text-sm text-gray-900">{value}</dd>
    </div>
  );
}

/** One number in the statistics grid. */
function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 text-xl font-bold text-gray-900">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-gray-500">{hint}</p>}
    </div>
  );
}

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

          {/* What the user actually submitted at KYC. Numbers are last-4 only;
              the whole BVN lives behind the audited compliance lookup. */}
          <section className="mb-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-baseline justify-between">
              <h2 className="text-lg font-semibold text-gray-900">KYC submission</h2>
              <span className="text-sm text-gray-500">
                {data.kyc.submittedAt
                  ? `Submitted ${formatDateTime(data.kyc.submittedAt)}`
                  : 'Not submitted'}
              </span>
            </div>

            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Legal name" value={show(data.kyc.legalName)} />
              <Field label="Date of birth" value={show(data.kyc.dateOfBirth)} />
              <Field label="Email" value={show(data.kyc.email)} />
              <Field label="Phone" value={show(data.kyc.phone)} />
              <Field
                label="BVN"
                value={data.kyc.bvnLast4 ? `•••• ${data.kyc.bvnLast4}` : DASH}
              />
              <Field
                label="ID document"
                value={
                  data.kyc.idDocType
                    ? `${ID_TYPE_LABELS[data.kyc.idDocType] ?? data.kyc.idDocType}${
                        data.kyc.idDocNumberLast4 ? ` · •••• ${data.kyc.idDocNumberLast4}` : ''
                      }`
                    : DASH
                }
              />
              <Field
                label="Address"
                value={
                  data.kyc.address.street
                    ? [
                        data.kyc.address.street,
                        data.kyc.address.city,
                        data.kyc.address.state,
                        data.kyc.address.postalCode,
                      ]
                        .filter(Boolean)
                        .join(', ')
                    : DASH
                }
              />
              <Field
                label="Provider customer"
                value={
                  data.kyc.mapleradCustomerId
                    ? `${data.kyc.mapleradCustomerId} (tier ${data.kyc.mapleradTier})`
                    : 'Not enrolled'
                }
              />
            </dl>

            <div className="mt-6">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
                ID document images
              </p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {(['front', 'back'] as const).map((side) => {
                  const url = data.kyc.documents[side];
                  return (
                    <div key={side}>
                      <p className="mb-1 text-sm font-medium capitalize text-gray-700">{side}</p>
                      {url ? (
                        <a href={url} target="_blank" rel="noopener noreferrer">
                          {/* Signed URL, short-lived. eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={url}
                            alt={`${side} of the ID document`}
                            className="h-48 w-full rounded-lg border border-gray-200 object-contain bg-gray-50"
                          />
                        </a>
                      ) : (
                        <div className="flex h-48 w-full items-center justify-center rounded-lg border border-dashed border-gray-300 bg-gray-50 text-sm text-gray-500">
                          Not uploaded
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          {/* Where this account connects from. */}
          <section className="mb-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold text-gray-900">Devices &amp; IP addresses</h2>

            <dl className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Last login" value={formatDateTime(data.activity.lastSeenAt)} />
              <Field label="Last IP" value={show(data.activity.lastIp)} />
              <Field label="Last device" value={show(data.activity.lastDevice)} />
              <Field label="Last action" value={show(data.activity.lastAction)} />
              <Field
                label="Last transaction IP"
                value={
                  data.activity.lastTransactionIp ?? (
                    <span className="text-gray-500">
                      {DASH}{' '}
                      <span className="text-xs">(not recorded before this release)</span>
                    </span>
                  )
                }
              />
              <Field
                label="Last transaction at"
                value={formatDateTime(data.activity.lastTransactionAt)}
              />
            </dl>

            {data.activity.devices.length === 0 ? (
              <p className="text-gray-500">No device activity recorded yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-gray-200 text-left text-gray-500">
                    <tr>
                      <th className="py-2 pr-4 font-medium">IP address</th>
                      <th className="py-2 pr-4 font-medium">Device</th>
                      <th className="py-2 pr-4 font-medium">Platform</th>
                      <th className="py-2 pr-4 font-medium">Seen</th>
                      <th className="py-2 pr-4 font-medium">First seen</th>
                      <th className="py-2 font-medium">Last seen</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {data.activity.devices.map((d) => (
                      <tr key={d.id}>
                        <td className="py-2 pr-4 font-mono text-gray-900">{show(d.ipAddress)}</td>
                        <td className="py-2 pr-4 text-gray-900">{show(d.device)}</td>
                        <td className="py-2 pr-4 text-gray-600">{d.platform}</td>
                        <td className="py-2 pr-4 text-gray-600">{d.hitCount}×</td>
                        <td className="py-2 pr-4 text-gray-600">{formatDateTime(d.firstSeenAt)}</td>
                        <td className="py-2 text-gray-600">{formatDateTime(d.lastSeenAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Statistics. */}
          <section className="mb-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold text-gray-900">Statistics</h2>

            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
              Activity &amp; lifecycle
            </p>
            <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
              <Stat label="Account age" value={`${data.stats.lifecycle.accountAgeDays}d`} />
              <Stat label="Transactions" value={data.stats.lifecycle.totalTransactions} />
              <Stat label="Completed" value={data.stats.lifecycle.completedTransactions} />
              <Stat label="Failed" value={data.stats.lifecycle.failedTransactions} />
              <Stat
                label="First transaction"
                value={
                  data.stats.lifecycle.firstTransactionAt
                    ? new Date(data.stats.lifecycle.firstTransactionAt).toLocaleDateString()
                    : DASH
                }
              />
              <Stat
                label="Last transaction"
                value={
                  data.stats.lifecycle.lastTransactionAt
                    ? new Date(data.stats.lifecycle.lastTransactionAt).toLocaleDateString()
                    : DASH
                }
              />
              <Stat
                label="Days since active"
                value={data.stats.lifecycle.daysSinceLastActivity ?? DASH}
              />
            </div>

            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
              Risk &amp; compliance
            </p>
            <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
              <Stat label="Devices" value={data.stats.risk.deviceCount} />
              <Stat label="Distinct IPs" value={data.stats.risk.distinctIpCount} />
              <Stat
                label="Failed rate"
                value={`${data.stats.risk.failedRate}%`}
                hint="of all transactions"
              />
              <Stat label="KYC submissions" value={data.stats.risk.kycSubmissionCount} />
              <Stat label="KYC tier" value={data.stats.risk.kycTier} />
              <Stat
                label="Provider enrolled"
                value={data.stats.risk.providerEnrolled ? 'Yes' : 'No'}
              />
              <Stat
                label="Deposit account"
                value={data.stats.risk.depositAccountNumber ?? 'None'}
              />
            </div>

            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
              Lifetime totals by type
            </p>
            {data.stats.byType.length === 0 ? (
              <p className="text-gray-500">No transactions yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-gray-200 text-left text-gray-500">
                    <tr>
                      <th className="py-2 pr-4 font-medium">Type</th>
                      <th className="py-2 pr-4 font-medium">Asset</th>
                      <th className="py-2 pr-4 font-medium">Count</th>
                      <th className="py-2 font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {data.stats.byType.map((g) => (
                      <tr key={`${g.type}-${g.asset}`}>
                        <td className="py-2 pr-4 font-medium text-gray-900">{g.type}</td>
                        <td className="py-2 pr-4 text-gray-600">{g.asset}</td>
                        <td className="py-2 pr-4 text-gray-600">{g.count}</td>
                        <td className="py-2 font-semibold text-gray-900">
                          {formatAmount(g.asset, g.total)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
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
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">IP</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {data.transactions.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-6 py-8 text-center text-gray-500">
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
                      <td className="px-6 py-4 font-mono text-sm text-gray-500">{show(t.ip)}</td>
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
