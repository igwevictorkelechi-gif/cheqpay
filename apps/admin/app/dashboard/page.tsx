'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Calendar, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import DashboardLayout from '@/components/DashboardLayout';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';

type Analytics = {
  windowDays: number;
  kpis: {
    totalUsers: number; activeUsers: number; totalWallets: number; fundedWallets: number;
    totalTransactions: number; ngnVolumeWindow: number; feesNgnWindow: number; successRate: number;
  };
  transactions: { daily: { date: string; count: number; ngnVolume: number }[] };
  bills: { topBillers: { name: string; count: number; ngnVolume: number }[] };
};

type AdminTx = {
  id: string;
  userEmail: string;
  type: string;
  asset: string;
  amount: string;
  status: string;
  createdAt: string;
};

const RANGES = [7, 30, 90];

function fmtNgn(n: number): string {
  return '₦' + Math.round(n || 0).toLocaleString('en-NG');
}
function fmtNgnCompact(n: number): string {
  const v = n || 0;
  if (v >= 1e9) return '₦' + (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return '₦' + (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e3) return '₦' + (v / 1e3).toFixed(1) + 'K';
  return '₦' + Math.round(v).toLocaleString('en-NG');
}
function fmtAmount(asset: string, value: string): string {
  const n = Number(value);
  const prefix = asset === 'NGN' ? '₦' : '';
  const suffix = asset === 'NGN' ? '' : ' ' + asset;
  if (!isFinite(n)) return prefix + value + suffix;
  return prefix + n.toLocaleString('en-NG', { maximumFractionDigits: asset === 'NGN' ? 2 : 8 }) + suffix;
}

/** % change of the second half of a daily series vs the first half. */
function halfOverHalf(daily: { ngnVolume: number; count: number }[], key: 'ngnVolume' | 'count') {
  if (daily.length < 4) return null;
  const mid = Math.floor(daily.length / 2);
  const a = daily.slice(0, mid).reduce((s, d) => s + d[key], 0);
  const b = daily.slice(mid).reduce((s, d) => s + d[key], 0);
  if (a <= 0) return null;
  return ((b - a) / a) * 100;
}

function DeltaChip({ pct }: { pct: number | null }) {
  if (pct === null) return null;
  const up = pct >= 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs font-semibold ${
        up ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
      }`}
    >
      {up ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
      {Math.abs(pct).toFixed(1)}%
    </span>
  );
}

function statusChip(status: string) {
  const s = status.toUpperCase();
  const cls =
    s === 'COMPLETED'
      ? 'bg-green-100 text-green-700'
      : s === 'FAILED' || s === 'REVERSED'
        ? 'bg-red-100 text-red-700'
        : 'bg-yellow-100 text-yellow-700';
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>{s.toLowerCase()}</span>;
}

export default function Dashboard() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Analytics | null>(null);
  const [recent, setRecent] = useState<AdminTx[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    Promise.all([
      fetch('/api/analytics?days=' + days).then(async (r) => {
        if (!r.ok) throw new Error('Failed to load overview (' + r.status + ')');
        return r.json() as Promise<Analytics>;
      }),
      fetch('/api/transactions?page=1')
        .then((r) => (r.ok ? r.json() : { transactions: [] }))
        .catch(() => ({ transactions: [] })),
    ])
      .then(([a, t]) => {
        if (!active) return;
        setData(a);
        setRecent(Array.isArray(t.transactions) ? t.transactions.slice(0, 6) : []);
      })
      .catch((e) => { if (active) setError(e.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [days]);

  const daily = useMemo(() => data?.transactions.daily ?? [], [data]);
  const volDelta = useMemo(() => halfOverHalf(daily, 'ngnVolume'), [daily]);
  const txDelta = useMemo(() => halfOverHalf(daily, 'count'), [daily]);
  const k = data?.kpis;

  const overview = [
    {
      label: 'Total volume',
      value: k ? fmtNgnCompact(k.ngnVolumeWindow) : '—',
      delta: volDelta,
      sub: `last ${days} days`,
    },
    {
      label: 'Transactions',
      value: k ? k.totalTransactions.toLocaleString() : '—',
      delta: txDelta,
      sub: 'all time',
    },
    {
      label: 'Active users',
      value: k ? k.activeUsers.toLocaleString() : '—',
      delta: null,
      sub: k ? `of ${k.totalUsers.toLocaleString()} users` : '',
    },
    {
      label: 'Fees earned',
      value: k ? fmtNgn(k.feesNgnWindow) : '—',
      delta: null,
      sub: `last ${days} days`,
    },
  ];

  return (
    <DashboardLayout>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
        <div className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white p-1">
          <Calendar size={15} className="ml-2 text-gray-400" />
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setDays(r)}
              className={
                'px-3 py-1.5 rounded-md text-sm font-medium transition-colors ' +
                (days === r ? 'bg-brand-600 text-white' : 'text-gray-600 hover:bg-gray-50')
              }
            >
              Last {r}d
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      )}

      {/* Overview */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
        <h2 className="text-lg font-bold text-gray-900 mb-5">Overview</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
          {overview.map((s) => (
            <div key={s.label} className="min-w-0">
              <p className="text-sm text-gray-500">{s.label}</p>
              <div className="mt-1 flex items-center gap-2">
                <p className="text-2xl font-bold text-gray-900 truncate">{loading ? '…' : s.value}</p>
                {!loading && <DeltaChip pct={s.delta} />}
              </div>
              <p className="text-xs text-gray-400 mt-1">{s.sub}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Revenue / volume chart */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Revenue</h2>
            <div className="mt-1 flex items-center gap-2">
              <p className="text-3xl font-bold text-gray-900">
                {loading ? '…' : k ? fmtNgn(k.ngnVolumeWindow) : '—'}
              </p>
              {!loading && <DeltaChip pct={volDelta} />}
            </div>
            <p className="text-xs text-gray-400 mt-1">
              Processed NGN volume · last {days} days · success rate {k ? k.successRate : '—'}%
            </p>
          </div>
        </div>
        <div className="mt-4" style={{ width: '100%', height: 280 }}>
          <ResponsiveContainer>
            <AreaChart data={daily}>
              <defs>
                <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#7c3aed" stopOpacity={0.45} />
                  <stop offset="95%" stopColor="#7c3aed" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#272433" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: '#8d87a0' }}
                tickFormatter={(d) => String(d).slice(5)}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: '#8d87a0' }}
                tickFormatter={(v) => fmtNgnCompact(Number(v))}
                width={64}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                formatter={(v) => fmtNgn(Number(v))}
                contentStyle={{
                  backgroundColor: '#17151f',
                  border: '1px solid #272433',
                  borderRadius: 8,
                  color: '#f2f1f7',
                }}
                labelStyle={{ color: '#8d87a0' }}
              />
              <Area
                type="monotone"
                dataKey="ngnVolume"
                stroke="#8b5cf6"
                strokeWidth={2}
                fill="url(#rev)"
                dot={{ r: 3, fill: '#8b5cf6', strokeWidth: 0 }}
                activeDot={{ r: 5 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Bottom tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-gray-900">Top billers</h2>
            <Link
              href="/analytics"
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-50"
            >
              View all
            </Link>
          </div>
          <table className="w-full text-sm">
            <thead className="text-left text-gray-500 border-b border-gray-100">
              <tr>
                <th className="py-2 font-medium">Biller</th>
                <th className="py-2 font-medium">Payments</th>
                <th className="py-2 font-medium text-right">Volume</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading && (
                <tr><td colSpan={3} className="py-6 text-center text-gray-400">Loading…</td></tr>
              )}
              {!loading && (data?.bills.topBillers ?? []).length === 0 && (
                <tr><td colSpan={3} className="py-6 text-center text-gray-400">No bill payments yet.</td></tr>
              )}
              {(data?.bills.topBillers ?? []).slice(0, 5).map((b) => (
                <tr key={b.name}>
                  <td className="py-3 font-medium text-gray-900">{b.name}</td>
                  <td className="py-3 text-gray-600">{b.count.toLocaleString()}</td>
                  <td className="py-3 text-right text-gray-900 font-semibold">{fmtNgn(b.ngnVolume)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-gray-900">Recent transactions</h2>
            <Link
              href="/transactions"
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-50"
            >
              View all
            </Link>
          </div>
          <table className="w-full text-sm">
            <thead className="text-left text-gray-500 border-b border-gray-100">
              <tr>
                <th className="py-2 font-medium">User</th>
                <th className="py-2 font-medium">Type</th>
                <th className="py-2 font-medium">Amount</th>
                <th className="py-2 font-medium text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading && (
                <tr><td colSpan={4} className="py-6 text-center text-gray-400">Loading…</td></tr>
              )}
              {!loading && recent.length === 0 && (
                <tr><td colSpan={4} className="py-6 text-center text-gray-400">No transactions yet.</td></tr>
              )}
              {recent.map((t) => (
                <tr key={t.id}>
                  <td className="py-3 text-gray-900 font-medium max-w-[140px] truncate">{t.userEmail}</td>
                  <td className="py-3 text-gray-600">{t.type.toLowerCase()}</td>
                  <td className="py-3 text-gray-900 font-semibold">{fmtAmount(t.asset, t.amount)}</td>
                  <td className="py-3 text-right">{statusChip(t.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </DashboardLayout>
  );
}
