'use client';

import React, { useState } from 'react';
import { Search, RotateCw, Copy } from 'lucide-react';
import DashboardLayout from '@/components/DashboardLayout';

export default function VirtualAccountsPage() {
  const [searchTerm, setSearchTerm] = useState('');

  const virtualAccounts = [
    {
      id: '1',
      userName: 'John Doe',
      accountNumber: '1000000001',
      bankName: 'Wema Bank',
      bankCode: '035',
      provider: 'paystack',
      status: 'active',
      createdAt: '2024-01-15',
    },
    {
      id: '2',
      userName: 'Jane Smith',
      accountNumber: '1000000002',
      bankName: 'Zenith Bank',
      bankCode: '057',
      provider: 'flutterwave',
      status: 'active',
      createdAt: '2024-01-20',
    },
    {
      id: '3',
      userName: 'Mike Johnson',
      accountNumber: '1000000003',
      bankName: 'GTBank',
      bankCode: '058',
      provider: 'paystack',
      status: 'inactive',
      createdAt: '2024-01-22',
    },
  ];

  const handleCopyAccount = (accountNumber: string) => {
    navigator.clipboard.writeText(accountNumber);
    alert('Account number copied!');
  };

  const handleRegenerate = (id: string) => {
    alert(`Regenerating virtual account for ${id}...`);
  };

  return (
    <DashboardLayout>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Virtual Accounts</h1>
        <p className="text-gray-600 mt-2">Manage user virtual accounts for wallet funding</p>
      </div>

      {/* Search */}
      <div className="mb-8 flex gap-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
          <input
            type="text"
            placeholder="Search by user name or account number..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
      </div>

      {/* Virtual Accounts Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">User</th>
              <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">Account Number</th>
              <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">Bank</th>
              <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">Provider</th>
              <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">Status</th>
              <th className="px-6 py-4 text-right text-sm font-semibold text-gray-900">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {virtualAccounts.map((va) => (
              <tr key={va.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-6 py-4">
                  <p className="font-semibold text-gray-900">{va.userName}</p>
                </td>
                <td className="px-6 py-4 font-mono text-gray-900">{va.accountNumber}</td>
                <td className="px-6 py-4 text-gray-900">{va.bankName}</td>
                <td className="px-6 py-4">
                  <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                    va.provider === 'paystack'
                      ? 'bg-blue-100 text-blue-800'
                      : 'bg-purple-100 text-purple-800'
                  }`}>
                    {va.provider}
                  </span>
                </td>
                <td className="px-6 py-4">
                  <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                    va.status === 'active'
                      ? 'bg-green-100 text-green-800'
                      : 'bg-gray-100 text-gray-800'
                  }`}>
                    {va.status}
                  </span>
                </td>
                <td className="px-6 py-4 text-right space-x-2">
                  <button
                    onClick={() => handleCopyAccount(va.accountNumber)}
                    className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-700 font-semibold text-sm"
                  >
                    <Copy size={16} />
                    Copy
                  </button>
                  <button
                    onClick={() => handleRegenerate(va.id)}
                    className="inline-flex items-center gap-1 text-orange-600 hover:text-orange-700 font-semibold text-sm"
                  >
                    <RotateCw size={16} />
                    Regenerate
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Info */}
      <div className="mt-8 bg-blue-50 border border-blue-200 rounded-lg p-4">
        <p className="text-sm text-blue-900">
          <strong>Note:</strong> Virtual accounts are automatically created when users sign up. You can regenerate an account if needed, which will create a new account number while keeping the old one active for a transition period.
        </p>
      </div>
    </DashboardLayout>
  );
}
