'use client';

import React, { useEffect, useState } from 'react';
import { Search, Download } from 'lucide-react';
import DashboardLayout from '@/components/DashboardLayout';

type AdminTx = {
  id: string;
  userEmail: string;
  type: string;
  asset: string;
  amount: string;
  status: string;
  reference: string;
  createdAt: string;
};
type Summary = {
  totalLast30: number;
  completed: number;
  failed: number;
  ngnVolumeLast30: string;
  successRate: number;
  failureRate: number;
};

const PAGE_SIZE = 10;

function formatAmount(asset: string, value: string): string {
  const n = Number(value);
  const prefix = asset === 'NGN' ? '₦' : '';
  const suffix = asset === 'NGN' ? '' : ' ' + asset;
  if (!isFinite(n)) return prefix + value + suffix;
  return prefix + n.toLocaleString('en-NG', { maximumFractionDigits: asset === 'NGN' ? 2 : 8 }) + suffix;
}

function formatNgnCompact(value: string): string {
  const n = Number(value);
  if (!isFinite(n)) return '₦' + value;
  if (n >= 1e9) return '₦' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '₦' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return '₦' + (n / 1e3).toFixed(1) + 'K';
  return '₦' + n.toLocaleString('en-NG');
}

function getTypeBadge(type: string) {
  const badges: Record<string, { bg: string; text: string }> = {
    DEPOSIT: { bg: 'bg-green-100', text: 'text-green-800' },
    WITHDRAWAL: { bg: 'bg-orange-100', text: 'text-orange-800' },
    BUY: { bg: 'bg-blue-100', text: 'text-blue-800' },
    SELL: { bg: 'bg-purple-100', text: 'text-purple-800' },
    CONVERT: { bg: 'bg-indigo-100', text: 'text-indigo-800' },
    BILL: { bg: 'bg-pink-100', text: 'text-pink-800' },
  };
  return badges[type.toUpperCase()] || { bg: 'bg-gray-100', text: 'text-gray-800' };
}

function getStatusBadge(status: string) {
  const badges: Record<string, { bg: string; text: string }> = {
    COMPLETED: { bg: 'bg-green-100', text: 'text-green-800' },
    PENDING: { bg: 'bg-yellow-100', text: 'text-yellow-800' },
    PROCESSING: { bg: 'bg-blue-100', text: 'text-blue-800' },
    FAILED: { bg: 'bg-red-100', text: 'text-red-800' },
    REVERSED: { bg: 'bg-gray-100', text: 'text-gray-800' },
  };
  return badges[status.toUpperCase()] || badges.PENDING;
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

export default function TransactionsPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [query, setQuery] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [page, setPage] = useState(1);
  const [txs, setTxs] = useState<AdminTx[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (query) params.set('search', query);
    if (filterType !== 'all') params.set('type', filterType);
    fetch('/api/transactions?' + params.toString())
      .then(async (r) => {
        if (!r.ok) throw new Error('Failed to load transactions (' + r.status + ')');
        return r.json();
      })
      .then((d) => {
        if (!active) return;
        setTxs(Array.isArray(d.transactions) ? d.transactions : []);
        setTotal(typeof d.total === 'number' ? d.total : 0);
        setSummary(d.summary ?? null);
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
  }, [page, query, filterType]);

  const onSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    setQuery(searchTerm.trim());
  };

  const handleExport = () => {
    const header = ['id', 'user', 'type', 'asset', 'amount', 'status', 'reference', 'date'];
    const rows = txs.map((t) => [t.id, t.userEmail, t.type, t.asset, t.amount, t.status, t.reference, t.createdAt]);
    const csv = [header, ...rows]
      .map((r) => r.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = 'transactions.csv';
    a.click();
    URL.revokeObjectURL(href);
  };

  const start = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const end = Math.min(page * PAGE_SIZE, total);
  const hasPrev = page > 1;
  const hasNext = page * PAGE_SIZE < total;

  return (
    <DashboardLayout>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Transactions</h1>
        <p className="text-gray-600 mt-2">View and manage all platform transactions</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <p className="text-gray-600 text-sm font-medium mb-2">Total Transactions</p>
          <p className="text-3xl font-bold text-gray-900">{summary ? summary.totalLast30.toLocaleString() : '—'}</p>
          <p className="text-xs text-gray-500 mt-2">Last 30 days</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <p className="text-gray-600 text-sm font-medium mb-2">Total Volume (NGN)</p>
          <p className="text-3xl font-bold text-gray-900">{summary ? formatNgnCompact(summary.ngnVolumeLast30) : '—'}</p>
          <p className="text-xs text-gray-500 mt-2">Last 30 days</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <p className="text-gray-600 text-sm font-medium mb-2">Completed</p>
          <p className="text-3xl font-bold text-green-600">{summary ? summary.completed.toLocaleString() : '—'}</p>
          <p className="text-xs text-gray-500 mt-2">{summary ? summary.successRate + '% success rate' : ''}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <p className="text-gray-600 text-sm font-medium mb-2">Failed</p>
          <p className="text-3xl font-bold text-red-600">{summary ? summary.failed.toLocaleString() : '—'}</p>
          <p className="text-xs text-gray-500 mt-2">{summary ? summary.failureRate + '% failure rate' : ''}</p>
        </div>
      </div>

      <form onSubmit={onSearch} className="mb-8 flex gap-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
          <input
            type="text"
            placeholder="Search by reference or tx hash..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <select
          value={filterType}
          onChange={(e) => {
            setPage(1);
            setFilterType(e.target.value);
          }}
          className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          <option value="all">All Types</option>
          <option value="DEPOSIT">Deposit</option>
          <option value="WITHDRAWAL">Withdrawal</option>
          <option value="BUY">Buy</option>
          <option value="SELL">Sell</option>
          <option value="CONVERT">Convert</option>
          <option value="BILL">Bill</option>
        </select>
        <button
          type="button"
          onClick={handleExport}
          className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700"
        >
          <Download size={18} />
          Export CSV
        </button>
      </form>

      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">Transaction ID</th>
              <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">User</th>
              <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">Type</th>
              <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">Amount</th>
              <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">Reference</th>
              <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">Status</th>
              <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">Date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {loading && (
              <tr><td colSpan={7} className="px-6 py-8 text-center text-gray-500">Loading…</td></tr>
            )}
            {!loading && txs.length === 0 && (
              <tr><td colSpan={7} className="px-6 py-8 text-center text-gray-500">No transactions found.</td></tr>
            )}
            {!loading && txs.map((tx) => {
              const typeBadge = getTypeBadge(tx.type);
              const statusBadge = getStatusBadge(tx.status);
              return (
                <tr key={tx.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4 font-mono text-sm text-gray-900 font-semibold">{tx.id.slice(0, 8)}</td>
                  <td className="px-6 py-4 text-gray-900">{tx.userEmail}</td>
                  <td className="px-6 py-4">
                    <span className={`px-3 py-1 rounded-full text-sm font-medium ${typeBadge.bg} ${typeBadge.text}`}>
                      {titleCase(tx.type)}
                    </span>
                  </td>
                  <td className="px-6 py-4 font-semibold text-gray-900">{formatAmount(tx.asset, tx.amount)}</td>
                  <td className="px-6 py-4 font-mono text-sm text-gray-600">{tx.reference}</td>
                  <td className="px-6 py-4">
                    <span className={`px-3 py-1 rounded-full text-sm font-medium ${statusBadge.bg} ${statusBadge.text}`}>
                      {titleCase(tx.status)}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">{new Date(tx.createdAt).toLocaleString()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-8 flex items-center justify-between">
        <p className="text-sm text-gray-600">
          {total === 0 ? 'No transactions' : 'Showing ' + start + ' to ' + end + ' of ' + total.toLocaleString() + ' transactions'}
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
