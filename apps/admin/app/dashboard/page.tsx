'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { TrendingUp, Users, Wallet, Clock } from 'lucide-react';
import DashboardLayout from '@/components/DashboardLayout';

type Stats = {
  totalWallets: number;
  activeUsers: number;
  pendingKyc: number;
  dailyVolumeNgn: string;
};
type RecentUser = { id: string; email: string; createdAt: string };

function formatNgn(value: string): string {
  const n = Number(value);
  if (!isFinite(n)) return `₦${value}`;
  return `₦${Math.round(n).toLocaleString('en-NG')}`;
}

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [recent, setRecent] = useState<RecentUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch('/api/stats')
      .then(async (r) => {
        if (!r.ok) throw new Error(`Failed to load stats (${r.status})`);
        return r.json();
      })
      .then((d) => {
        if (!active) return;
        setStats(d.stats ?? null);
        setRecent(Array.isArray(d.recentUsers) ? d.recentUsers : []);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const cards = [
    { title: 'Total Wallets', value: stats ? stats.totalWallets.toLocaleString() : '—', icon: Wallet, color: 'bg-blue-100 text-blue-600' },
    { title: 'Active Users', value: stats ? stats.activeUsers.toLocaleString() : '—', icon: Users, color: 'bg-brand-100 text-brand-600' },
    { title: 'Pending KYC', value: stats ? stats.pendingKyc.toLocaleString() : '—', icon: Clock, color: 'bg-yellow-100 text-yellow-600' },
    { title: 'Daily Volume', value: stats ? formatNgn(stats.dailyVolumeNgn) : '—', icon: TrendingUp, color: 'bg-purple-100 text-purple-600' },
  ];

  return (
    <DashboardLayout>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-600 mt-2">Welcome back! Here&apos;s what&apos;s happening with your business today.</p>
      </div>

      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {cards.map((stat, index) => {
          const Icon = stat.icon;
          return (
            <div key={index} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-gray-600 font-medium">{stat.title}</h3>
                <div className={`p-3 rounded-lg ${stat.color}`}>
                  <Icon size={20} />
                </div>
              </div>
              <p className="text-2xl font-bold text-gray-900 mb-2">{loading ? '…' : stat.value}</p>
              <p className="text-sm text-gray-500">Live</p>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-bold text-gray-900">Recent Users</h2>
            <Link href="/users" className="text-brand-600 text-sm font-semibold hover:underline">View All</Link>
          </div>
          <div className="space-y-4">
            {loading && <p className="text-sm text-gray-500">Loading…</p>}
            {!loading && recent.length === 0 && <p className="text-sm text-gray-500">No users yet.</p>}
            {recent.map((u) => (
              <div key={u.id} className="flex items-center gap-3 pb-4 border-b border-gray-100 last:border-0">
                <div className="w-10 h-10 rounded-full bg-gray-300" />
                <div className="flex-1">
                  <p className="font-medium text-gray-900">{u.email}</p>
                  <p className="text-sm text-gray-500">{new Date(u.createdAt).toLocaleDateString()}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-bold text-gray-900 mb-6">Quick Actions</h2>
          <div className="space-y-3">
            <Link href="/payment-settings" className="block p-4 bg-brand-50 hover:bg-brand-100 rounded-lg transition-colors">
              <p className="font-semibold text-brand-900">Configure Payment Gateways</p>
              <p className="text-sm text-brand-700 mt-1">Set up Paystack &amp; Flutterwave API keys</p>
            </Link>
            <Link href="/virtual-accounts" className="block p-4 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors">
              <p className="font-semibold text-blue-900">Manage Virtual Accounts</p>
              <p className="text-sm text-blue-700 mt-1">View and regenerate user virtual accounts</p>
            </Link>
            <Link href="/transactions" className="block p-4 bg-purple-50 hover:bg-purple-100 rounded-lg transition-colors">
              <p className="font-semibold text-purple-900">Transaction Analytics</p>
              <p className="text-sm text-purple-700 mt-1">View all platform transactions</p>
            </Link>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
