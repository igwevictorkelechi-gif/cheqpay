'use client';

import React, { useState } from 'react';
import { Search, Filter, ChevronRight } from 'lucide-react';
import DashboardLayout from '@/components/DashboardLayout';

export default function UsersPage() {
  const [searchTerm, setSearchTerm] = useState('');

  const users = [
    {
      id: '1',
      name: 'John Doe',
      phone: '08012345678',
      email: 'john@example.com',
      kycStatus: 'approved',
      walletBalance: '₦125,500.00',
      createdAt: '2024-01-15',
    },
    {
      id: '2',
      name: 'Jane Smith',
      phone: '08087654321',
      email: 'jane@example.com',
      kycStatus: 'pending',
      walletBalance: '₦45,000.00',
      createdAt: '2024-01-20',
    },
    {
      id: '3',
      name: 'Mike Johnson',
      phone: '08098765432',
      email: 'mike@example.com',
      kycStatus: 'rejected',
      walletBalance: '₦5,200.00',
      createdAt: '2024-01-22',
    },
  ];

  const getKYCBadge = (status: string) => {
    const badges: Record<string, { bg: string; text: string }> = {
      approved: { bg: 'bg-green-100', text: 'text-green-800' },
      pending: { bg: 'bg-yellow-100', text: 'text-yellow-800' },
      rejected: { bg: 'bg-red-100', text: 'text-red-800' },
    };
    return badges[status] || badges.pending;
  };

  return (
    <DashboardLayout>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Users</h1>
        <p className="text-gray-600 mt-2">Manage and monitor all platform users</p>
      </div>

      {/* Filters */}
      <div className="mb-8 flex gap-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
          <input
            type="text"
            placeholder="Search by name, email, or phone..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <button className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">
          <Filter size={20} className="text-gray-600" />
          <span>Filter</span>
        </button>
      </div>

      {/* Users Table */}
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
            {users.map((user) => {
              const badge = getKYCBadge(user.kycStatus);
              return (
                <tr key={user.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4">
                    <div>
                      <p className="font-semibold text-gray-900">{user.name}</p>
                      <p className="text-sm text-gray-500">{user.email}</p>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-gray-900">{user.phone}</td>
                  <td className="px-6 py-4">
                    <span className={`px-3 py-1 rounded-full text-sm font-medium ${badge.bg} ${badge.text}`}>
                      {user.kycStatus.charAt(0).toUpperCase() + user.kycStatus.slice(1)}
                    </span>
                  </td>
                  <td className="px-6 py-4 font-semibold text-gray-900">{user.walletBalance}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">{user.createdAt}</td>
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

      {/* Pagination */}
      <div className="mt-8 flex items-center justify-between">
        <p className="text-sm text-gray-600">Showing 1 to 10 of 2,543 users</p>
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
