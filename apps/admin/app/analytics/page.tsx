'use client';

import React, { useEffect, useState } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { Users, Wallet, Activity, TrendingUp, Receipt, CheckCircle, Coins, CreditCard } from 'lucide-react';
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';

type Analytics = {
  windowDays: number;
  kpis: {
    totalUsers: number; activeUsers: number; totalWallets: number; fundedWallets: number;
    totalTransactions: number; ngnVolumeWindow: number; feesNgnWindow: number; successRate: number;
  };
  balancesByAsset: Record<string, string>;
  kyc: { tiers: Record<string, number>; records: Record<string, number> };
  transactions: {
    byType: { type: string; count: number; ngnVolume: number }[];
    byStatus: { status: string; count: number }[];
    daily: { date: string; count: number; ngnVolume: number }[];
  };
  bills: {
    totals: { count: number; ngnVolume: number; successRate: number };
    byService: { service: string; count: number; ngnVolume: number; successRate: number }[];
    topBillers: { name: string; count: number; ngnVolume: number }[];
  };
};

const RANGES = [7, 30, 90];
const COLORS = ['#7c3aed', '#2563eb', '#16a34a', '#f59e0b', '#db2777', '#0891b2', '#dc2626', '#4f46e5'];

function fmtInt(n: number): string { return (n || 0).toLocaleString(); }
function fmtNgn(n: number): string { return '₦' + Math.round(n || 0).toLocaleString('en-NG'); }
function fmtNgnCompact(n: number): string {
  const v = n || 0;
  if (v >= 1e9) return '₦' + (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return '₦' + (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e3) return '₦' + (v / 1e3).toFixed(1) + 'K';
  return '₦' + Math.round(v).toLocaleString('en-NG');
}
function titleCase(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase(); }

export default function AnalyticsPage() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    fetch('/api/analytics?days=' + days)
      .then(async (r) => {
        if (!r.ok) throw new Error('Failed to load analytics (' + r.status + ')');
        return r.json();
      })
      .then((d) => { if (active) setData(d); })
      .catch((e) => { if (active) setError(e.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [days]);

  const k = data?.kpis;
  const kpiCards = [
    { label: 'Total Users', value: k ? fmtInt(k.totalUsers) : '—', sub: k ? fmtInt(k.activeUsers) + ' active' : '', icon: Users, color: 'bg-blue-100 text-blue-600' },
    { label: 'Funded Wallets', value: k ? fmtInt(k.fundedWallets) : '—', sub: k ? 'of ' + fmtInt(k.totalWallets) + ' wallets' : '', icon: Wallet, color: 'bg-brand-100 text-brand-600' },
    { label: 'Transactions', value: k ? fmtInt(k.totalTransactions) : '—', sub: 'all time', icon: Activity, color: 'bg-purple-100 text-purple-600' },
    { label: 'Volume (NGN)', value: k ? fmtNgnCompact(k.ngnVolumeWindow) : '—', sub: 'last ' + days + 'd', icon: TrendingUp, color: 'bg-green-100 text-green-600' },
    { label: 'Fees (NGN)', value: k ? fmtNgnCompact(k.feesNgnWindow) : '—', sub: 'last ' + days + 'd', icon: Coins, color: 'bg-amber-100 text-amber-600' },
    { label: 'Success Rate', value: k ? k.successRate + '%' : '—', sub: 'last ' + days + 'd', icon: CheckCircle, color: 'bg-emerald-100 text-emerald-600' },
  ];

  return (
    <DashboardLayout>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Analytics</h1>
          <p className="text-gray-600 mt-2">Platform performance, transactions &amp; bill payments</p>
        </div>
        <div className="inline-flex rounded-lg border border-gray-200 bg-white p-1">
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setDays(r)}
              className={'px-4 py-1.5 rounded-md text-sm font-medium transition-colors ' + (days === r ? 'bg-brand-600 text-white' : 'text-gray-600 hover:bg-gray-50')}
            >
              {r}d
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-6 gap-4 mb-8">
        {kpiCards.map((c, i) => {
          const Icon = c.icon;
          return (
            <div key={i} className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
              <div className={'inline-flex p-2 rounded-lg mb-3 ' + c.color}><Icon size={18} /></div>
              <p className="text-sm text-gray-500">{c.label}</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{loading ? '…' : c.value}</p>
              <p className="text-xs text-gray-400 mt-1">{c.sub}</p>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-bold text-gray-900 mb-4">Daily NGN Volume</h2>
          <div style={{ width: '100%', height: 280 }}>
            <ResponsiveContainer>
              <AreaChart data={data?.transactions.daily ?? []}>
                <defs>
                  <linearGradient id="vol" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#7c3aed" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#7c3aed" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d) => String(d).slice(5)} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => fmtNgnCompact(Number(v))} width={64} />
                <Tooltip formatter={(v) => fmtNgn(Number(v))} />
                <Area type="monotone" dataKey="ngnVolume" stroke="#7c3aed" fill="url(#vol)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-bold text-gray-900 mb-4">By Type</h2>
          <div style={{ width: '100%', height: 280 }}>
            <ResponsiveContainer>
              <BarChart data={data?.transactions.byType ?? []} layout="vertical" margin={{ left: 8 }}>
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="type" tick={{ fontSize: 11 }} width={80} tickFormatter={(t) => titleCase(String(t))} />
                <Tooltip />
                <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                  {(data?.transactions.byType ?? []).map((e, i) => (<Cell key={i} fill={COLORS[i % COLORS.length]} />))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="mb-3 flex items-center gap-2 flex-wrap">
        <Receipt size={20} className="text-brand-600" />
        <h2 className="text-xl font-bold text-gray-900">Bill Payments</h2>
        {data && (
          <span className="text-sm text-gray-500">
            {fmtInt(data.bills.totals.count)} payments · {fmtNgn(data.bills.totals.ngnVolume)} · {data.bills.totals.successRate}% success
          </span>
        )}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h3 className="font-bold text-gray-900 mb-4">Volume by Service</h3>
          <div style={{ width: '100%', height: 240 }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie data={data?.bills.byService ?? []} dataKey="ngnVolume" nameKey="service" cx="50%" cy="50%" innerRadius={50} outerRadius={90} paddingAngle={2}>
                  {(data?.bills.byService ?? []).map((e, i) => (<Cell key={i} fill={COLORS[i % COLORS.length]} />))}
                </Pie>
                <Tooltip formatter={(v) => fmtNgn(Number(v))} />
                <Legend formatter={(val) => titleCase(String(val))} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-gray-200 p-6 overflow-x-auto">
          <h3 className="font-bold text-gray-900 mb-4">Service Breakdown</h3>
          <table className="w-full text-sm">
            <thead className="text-left text-gray-500 border-b border-gray-100">
              <tr>
                <th className="py-2">Service</th>
                <th className="py-2">Payments</th>
                <th className="py-2">Volume</th>
                <th className="py-2">Success</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(data?.bills.byService ?? []).length === 0 && (
                <tr><td colSpan={4} className="py-6 text-center text-gray-400">No bill payments in this window.</td></tr>
              )}
              {(data?.bills.byService ?? []).map((s, i) => (
                <tr key={i}>
                  <td className="py-2 font-medium text-gray-900">{titleCase(s.service)}</td>
                  <td className="py-2 text-gray-700">{fmtInt(s.count)}</td>
                  <td className="py-2 text-gray-700">{fmtNgn(s.ngnVolume)}</td>
                  <td className="py-2">
                    <span className={'px-2 py-0.5 rounded-full text-xs font-medium ' + (s.successRate >= 90 ? 'bg-green-100 text-green-700' : s.successRate >= 60 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700')}>
                      {s.successRate}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h3 className="font-bold text-gray-900 mb-4">Top Billers</h3>
          <div style={{ width: '100%', height: 240 }}>
            <ResponsiveContainer>
              <BarChart data={data?.bills.topBillers ?? []} layout="vertical" margin={{ left: 8 }}>
                <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => fmtNgnCompact(Number(v))} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={90} />
                <Tooltip formatter={(v) => fmtNgn(Number(v))} />
                <Bar dataKey="ngnVolume" fill="#7c3aed" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h3 className="font-bold text-gray-900 mb-4">KYC Funnel</h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between"><span className="text-sm text-gray-600">Tier 0</span><span className="font-semibold text-gray-900">{fmtInt(data?.kyc.tiers['0'] ?? 0)}</span></div>
            <div className="flex items-center justify-between"><span className="text-sm text-gray-600">Tier 1</span><span className="font-semibold text-gray-900">{fmtInt(data?.kyc.tiers['1'] ?? 0)}</span></div>
            <div className="flex items-center justify-between"><span className="text-sm text-gray-600">Tier 2</span><span className="font-semibold text-gray-900">{fmtInt(data?.kyc.tiers['2'] ?? 0)}</span></div>
            <div className="border-t border-gray-100 pt-3 space-y-2">
              <div className="flex items-center justify-between"><span className="text-sm text-yellow-700">Pending review</span><span className="font-semibold">{fmtInt(data?.kyc.records.PENDING ?? 0)}</span></div>
              <div className="flex items-center justify-between"><span className="text-sm text-green-700">Approved</span><span className="font-semibold">{fmtInt(data?.kyc.records.APPROVED ?? 0)}</span></div>
              <div className="flex items-center justify-between"><span className="text-sm text-red-700">Rejected</span><span className="font-semibold">{fmtInt(data?.kyc.records.REJECTED ?? 0)}</span></div>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h3 className="font-bold text-gray-900 mb-4">Custody Balances</h3>
          <div className="space-y-4">
            {['NGN', 'BTC', 'USDT'].map((asset, i) => (
              <div key={i} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CreditCard size={16} className="text-gray-400" />
                  <span className="text-sm font-medium text-gray-700">{asset}</span>
                </div>
                <span className="font-semibold text-gray-900">
                  {asset === 'NGN' ? fmtNgn(Number(data?.balancesByAsset?.NGN ?? 0)) : (data?.balancesByAsset?.[asset] ?? '0')}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
