'use client';

import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import {
  LayoutGrid, BarChart3, Users, CreditCard, Settings, LogOut, Activity, TrendingUp, Image as ImageIcon,
} from 'lucide-react';

export default function Sidebar({ open = false, onClose }: { open?: boolean; onClose?: () => void }) {
  const pathname = usePathname();
  const menuItems = [
    { icon: LayoutGrid, label: 'Dashboard', href: '/dashboard' },
    { icon: BarChart3, label: 'Analytics', href: '/analytics' },
    { icon: Users, label: 'Users', href: '/users' },
    { icon: CreditCard, label: 'Virtual Accounts', href: '/virtual-accounts' },
    { icon: Activity, label: 'Transactions', href: '/transactions' },
    { icon: TrendingUp, label: 'Trading Settings', href: '/trading-settings' },
    { icon: ImageIcon, label: 'Bill Logos', href: '/bill-logos' },
    { icon: Settings, label: 'Payment Settings', href: '/payment-settings' },
  ];

  return (
    <>
      {/* Mobile backdrop */}
      {open && (
        <div
          className="lg:hidden fixed inset-0 bg-black/40 z-40"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        className={
          'w-64 bg-white border-r border-gray-200 min-h-screen fixed left-0 top-0 z-50 flex flex-col transform transition-transform duration-200 ease-in-out ' +
          (open ? 'translate-x-0' : '-translate-x-full') +
          ' lg:translate-x-0'
        }
      >
        {/* Logo */}
        <div className="p-6 border-b border-gray-200">
          <Image
            src="/cheqpay-logo.png"
            alt="CheqPay"
            width={180}
            height={75}
            priority
            className="h-auto w-[160px]"
          />
          <p className="mt-2 text-sm text-gray-500">Admin Panel</p>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto p-4 space-y-1">
          {menuItems.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={
                  'flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition-colors ' +
                  (active
                    ? 'bg-brand-50 text-brand-600'
                    : 'text-gray-700 hover:bg-brand-50 hover:text-brand-600')
                }
              >
                <Icon size={20} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Logout */}
        <div className="p-4 border-t border-gray-200 bg-white">
          <button className="w-full flex items-center gap-3 px-4 py-3 text-red-600 hover:bg-red-50 rounded-lg transition-colors">
            <LogOut size={20} />
            <span className="font-medium">Logout</span>
          </button>
        </div>
      </aside>
    </>
  );
}
