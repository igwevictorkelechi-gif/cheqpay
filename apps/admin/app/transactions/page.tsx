'use client';

import React, { useState } from 'react';
import { Search, Download } from 'lucide-react';
import DashboardLayout from '@/components/DashboardLayout';

export default function TransactionsPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState('all');

  const transactions = [
    {
      id: 'TXN001',
      user: 'John Doe',
      type: 'credit',
      amount: '₦25,000.00',
      reference: 'PAYSTACK_12345',
      status: 'completed',
      date: '2024-01-25 10:30',
    },
    {
      id: 'TXN002',
      user: 'Jane Smith',
      type: 'transfer',
      amount: '₦5,000.00',
      reference: 'TRF_12345',
      status: 'completed',
      date: '2024-01-25 09:15',
    },
    {
      id: 'TXN003',
      user: 'Mike Johnson',
      type: 'withdrawal',
      amount: '₦10,000.00',
      reference: 'WTH_12345',
      status: 'pending',
      date: '2024-01-25 08:45',
    },
    {
      id: 'TXN004',
      user: 'Sarah Williams',
      type: 'credit',
      amount: '₦15,500.00',
      reference: 'FLUTTERWAVE_678',
      status: 'completed',
      date: '2024-01-24 16:20',
    },
  ];

  const getTransactionBadge = (type: string) => {
    const badges: Record<string, { bg: string; text: string; icon: string }> = {
      credit: { bg: 'bg-green-100', text: 'text-green-800', icon: '↓' },
      debit: { bg: 'bg-red-100', text: 'text-red-800', icon: '↑' },
      transfer: { bg: 'bg-blue-100', text: 'text-blue-800', icon: '⇄' },
      withdrawal: { bg: 'bg-orange-100', text: 'text-orange-800', icon: '↑' },
    };
    return badges[type] || badges.credit;
  };

  const getStatusBadge = (status: string) => {
    const badges: Record<string, { bg: string; text: string }> = {
      completed: { bg: 'bg-green-100', text: 'text-green-800' },
      pending: { bg: 'bg-yellow-100', text: 'text-yellow-800' },
      failed: { bg: 'bg-red-100', text: 'text-red-800' },
    };
    return badges[status] || badges.pending;
  };

  const handleExport = () => {
    alert('Exporting transactions as CSV...');
  };

  return (
    <DashboardLayout>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Transactions</h1>
        <p className="text-gray-600 mt-2">View and manage all platform transactions</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <p className="text-gray-600 text-sm font-medium mb-2">Total Transactions</p>
          <p className="text-3xl font-bold text-gray-900">24,582</p>
          <p className="text-xs text-gray-500 mt-2">Last 30 days</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <p className="text-gray-600 text-sm font-medium mb-2">Total Volume</p>
          <p className="text-3xl font-bold text-gray-900">₦1.24B</p>
          <p className="text-xs text-gray-500 mt-2">Last 30 days</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <p className="text-gray-600 text-sm font-medium mb-2">Completed</p>
          <p className="text-3xl font-bold text-green-600">24,150</p>
          <p className="text-xs text-gray-500 mt-2">98.2% success rate</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <p className="text-gray-600 text-sm font-medium mb-2">Failed</p>
          <p className="text-3xl font-bold text-red-600">432</p>
          <p className="text-xs text-gray-500 mt-2">1.8% failure rate</p>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-8 flex gap-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
          <input
            type="text"
            placeholder="Search by reference, user, or transaction ID..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          <option value="all">All Types</option>
          <option value="credit">Credit</option>
          <option value="transfer">Transfer</option>
          <option value="withdrawal">Withdrawal</option>
        </select>
        <button
          onClick={handleExport}
          className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700"
        >
          <Download size={18} />
          Export CSV
        </button>
      </div>

      {/* Transactions Table */}
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
            {transactions.map((tx) => {
              const typeBadge = getTransactionBadge(tx.type);
              const statusBadge = getStatusBadge(tx.status);
              return (
                <tr key={tx.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4 font-mono text-sm text-gray-900 font-semibold">{tx.id}</td>
                  <td className="px-6 py-4 text-gray-900">{tx.user}</td>
                  <td className="px-6 py-4">
                    <span className={`px-3 py-1 rounded-full text-sm font-medium ${typeBadge.bg} ${typeBadge.text}`}>
                      {tx.type.charAt(0).toUpperCase() + tx.type.slice(1)}
                    </span>
                  </td>
                  <td className="px-6 py-4 font-semibold text-gray-900">{tx.amount}</td>
                  <td className="px-6 py-4 font-mono text-sm text-gray-600">{tx.reference}</td>
                  <td className="px-6 py-4">
                    <span className={`px-3 py-1 rounded-full text-sm font-medium ${statusBadge.bg} ${statusBadge.text}`}>
                      {tx.status.charAt(0).toUpperCase() + tx.status.slice(1)}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">{tx.date}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="mt-8 flex items-center justify-between">
        <p className="text-sm text-gray-600">Showing 1 to 10 of 24,582 transactions</p>
        <div className="flex gap-2">
          <button className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50">
            Previous
          </button>
          <button className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">
            Next
          </button>
        </div>
      </div>
    </DashboardLayout>
  );
}
