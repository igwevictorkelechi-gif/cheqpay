'use client';

import React, { useEffect, useState } from 'react';
import { Search, Copy, Check, CreditCard, RefreshCw } from 'lucide-react';
import DashboardLayout from '@/components/DashboardLayout';

type VirtualAccount = {
  id: string;
  userId: string;
  email: string;
  kycTier: number;
  userStatus: string;
  accountNumber: string;
  bankName: string;
  bankCode: string | null;
  permanent: boolean;
  createdAt: string;
};

export default function VirtualAccountsPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [rows, setRows] = useState<VirtualAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    const q = searchTerm.trim();
    const t = setTimeout(() => {
      fetch('/api/virtual-accounts' + (q ? `?q=${encodeURIComponent(q)}` : ''), { cache: 'no-store' })
        .then(async (r) => {
          if (!r.ok) throw new Error('Failed to load virtual accounts (' + r.status + ')');
          return r.json();
        })
        .then((d) => { if (active) setRows(Array.isArray(d.virtualAccounts) ? d.virtualAccounts : []); })
        .catch((e) => { if (active) setError(e.message); })
        .finally(() => { if (active) setLoading(false); });
    }, q ? 350 : 0);
    return () => { active = false; clearTimeout(t); };
  }, [searchTerm, reload]);

  const copyAccount = async (accountNumber: string) => {
    try {
      await navigator.clipboard.writeText(accountNumber);
      setCopied(accountNumber);
      setTimeout(() => setCopied(null), 1500);
    } catch { /* clipboard unavailable */ }
  };

  return (
    <DashboardLayout>
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Virtual Accounts</h1>
          <p className="text-gray-600 mt-2">Dedicated NGN deposit accounts issued to users</p>
        </div>
        <button
          onClick={() => setReload((n) => n + 1)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      <div className="mb-6 relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
        <input
          type="text"
          placeholder="Search by user email or account number..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
      </div>

      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">User</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">Account Number</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">Bank</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">Type</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">KYC</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">Created</th>
                <th className="px-6 py-4 text-right text-sm font-semibold text-gray-900">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {loading && (
                <tr><td colSpan={7} className="px-6 py-10 text-center text-gray-400">Loading…</td></tr>
              )}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center">
                    <CreditCard size={36} className="mx-auto text-gray-300 mb-3" />
                    <p className="font-semibold text-gray-700">
                      {searchTerm ? 'No accounts match your search' : 'No virtual accounts yet'}
                    </p>
                    <p className="text-sm text-gray-400 mt-1">
                      Accounts are created when a verified user opens the deposit screen.
                    </p>
                  </td>
                </tr>
              )}
              {!loading && rows.map((va) => (
                <tr key={va.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4">
                    <p className="font-semibold text-gray-900">{va.email}</p>
                    {va.userStatus !== 'ACTIVE' && (
                      <span className="text-xs font-medium text-red-600">{va.userStatus}</span>
                    )}
                  </td>
                  <td className="px-6 py-4 font-mono text-gray-900">{va.accountNumber}</td>
                  <td className="px-6 py-4 text-gray-900">{va.bankName}</td>
                  <td className="px-6 py-4">
                    <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                      va.permanent ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
                    }`}>
                      {va.permanent ? 'Permanent' : 'Temporary'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-gray-700">Tier {va.kycTier}</td>
                  <td className="px-6 py-4 text-gray-500 text-sm">
                    {new Date(va.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button
                      onClick={() => copyAccount(va.accountNumber)}
                      className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-700 font-semibold text-sm"
                    >
                      {copied === va.accountNumber ? <Check size={16} className="text-green-600" /> : <Copy size={16} />}
                      {copied === va.accountNumber ? 'Copied' : 'Copy'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-8 bg-blue-50 border border-blue-200 rounded-lg p-4">
        <p className="text-sm text-blue-900">
          <strong>Note:</strong> A permanent account is minted after the user completes BVN
          verification (KYC). Bank transfers into these accounts are credited to the user&apos;s
          Naira balance automatically via the Flutterwave webhook.
        </p>
      </div>
    </DashboardLayout>
  );
}
