'use client';

import React, { useEffect, useState } from 'react';
import { Search, Filter, ChevronRight } from 'lucide-react';
import DashboardLayout from '@/components/DashboardLayout';

type AdminUser = {
  id: string;
  email: string;
  phone: string;
  kycStatus: string;
  ngnBalance: string;
  createdAt: string;
};

const PAGE_SIZE = 10;

function formatNgn(value: string): string {
  const n = Number(value);
  if (!isFinite(n)) return `₦${value}`;
  return `₦${n.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function getKYCBadge(status: string) {
  const badges: Record<string, { bg: string; text: string }> = {
    approved: { bg: 'bg-green-100', text: 'text-green-800' },
    pending: { bg: 'bg-yellow-100', text: 'text-yellow-800' },
    rejected: { bg: 'bg-red-100', text: 'text-red-800' },
  };
  return badges[status.toLowerCase()] || badges.pending;
}

export default function UsersPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (query) params.set('search', query);
    fetch(`/api/users?${params.toString()}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`Failed to load users (${r.status})`);
        return r.json();
      })
      .then((d) => {
        if (!active) return;
        setUsers(Array.isArray(d.users) ? d.users : []);
        setTotal(typeof d.total === 'number' ? d.total : 0);
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
  }, [page, query]);

  const onSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    setQuery(searchTerm.trim());
  };

  const start = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const end = Math.min(page * PAGE_SIZE, total);
  const hasPrev = page > 1;
  const hasNext = page * PAGE_SIZE < total;

  return (
    <DashboardLayout>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Users</h1>
        <p className="text-gray-600 mt-2">Manage and monitor all platform users</p>
      </div>

      <form onSubmit={onSearch} className="mb-8 flex gap-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
          <input
            type="text"
            placeholder="Search by email or phone..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <button type="submit" className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">
          <Filter size={20} className="text-gray-600" />
          <span>Search</span>
        </button>
      </form>

      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">User</th>
              <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">Phone</th>
              <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">KYC Status</th>
              <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">Wallet Balance</th>
              <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">Joined</th>
              <th className="px-6 py-4 text-right text-sm font-semibold text-gray-900">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {loading && (
              <tr><td colSpan={6} className="px-6 py-8 text-center text-gray-500">Loading…</td></tr>
            )}
            {!loading && users.length === 0 && (
              <tr><td colSpan={6} className="px-6 py-8 text-center text-gray-500">No users found.</td></tr>
            )}
            {!loading && users.map((user) => {
              const badge = getKYCBadge(user.kycStatus);
              const label = user.kycStatus.charAt(0).toUpperCase() + user.kycStatus.slice(1).toLowerCase();
              return (
                <tr key={user.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4">
                    <div>
                      <p className="font-semibold text-gray-900">{user.email}</p>
                      <p className="text-sm text-gray-500">{user.id.slice(0, 8)}</p>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-gray-900">{user.phone}</td>
                  <td className="px-6 py-4">
                    <span className={`px-3 py-1 rounded-full text-sm font-medium ${badge.bg} ${badge.text}`}>
                      {label}
                    </span>
                  </td>
                  <td className="px-6 py-4 font-semibold text-gray-900">{formatNgn(user.ngnBalance)}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">{new Date(user.createdAt).toLocaleDateString()}</td>
                  <td className="px-6 py-4 text-right">
                    <button className="text-brand-600 hover:text-brand-700 font-semibold flex items-center gap-1 ml-auto">
                      View
                      <ChevronRight size={16} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-8 flex items-center justify-between">
        <p className="text-sm text-gray-600">
          {total === 0 ? 'No users' : `Showing ${start} to ${end} of ${total.toLocaleString()} users`}
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => hasPrev && setPage((p) => p - 1)}
            disabled={!hasPrev}
            className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            Previous
          </button>
          <button
            onClick={() => hasNext && setPage((p) => p + 1)}
            disabled={!hasNext}
            className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </div>
    </DashboardLayout>
  );
}
