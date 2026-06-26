import React from 'react';
import Link from 'next/link';
import { LayoutGrid, Users, CreditCard, Settings, LogOut, Activity } from 'lucide-react';

export default function Sidebar() {
  const menuItems = [
    { icon: LayoutGrid, label: 'Dashboard', href: '/dashboard' },
    { icon: Users, label: 'Users', href: '/users' },
    { icon: CreditCard, label: 'Virtual Accounts', href: '/virtual-accounts' },
    { icon: Activity, label: 'Transactions', href: '/transactions' },
    { icon: Settings, label: 'Payment Settings', href: '/payment-settings' },
  ];

  return (
    <aside className="w-64 bg-white border-r border-gray-200 min-h-screen fixed left-0 top-0">
      {/* Logo */}
      <div className="p-6 border-b border-gray-200">
        <h1 className="text-2xl font-bold text-green-600">CheqPay</h1>
        <p className="text-sm text-gray-500">Admin Panel</p>
      </div>

      {/* Navigation */}
      <nav className="p-4 space-y-2">
        {menuItems.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-3 px-4 py-3 rounded-lg text-gray-700 hover:bg-green-50 hover:text-green-600 transition-colors"
            >
              <Icon size={20} />
              <span className="font-medium">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Logout */}
      <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-gray-200 bg-white">
        <button className="w-full flex items-center gap-3 px-4 py-3 text-red-600 hover:bg-red-50 rounded-lg transition-colors">
          <LogOut size={20} />
          <span className="font-medium">Logout</span>
        </button>
      </div>
    </aside>
  );
}
