'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutGrid, BarChart3, Users, ShieldCheck, CreditCard, Activity,
  TrendingUp, Receipt, Settings, Server, Wallet, LogOut, ChevronDown,
  Banknote, MessageSquare, KeyRound, ToggleLeft, type LucideIcon,
} from 'lucide-react';

type Item = { label: string; href: string; icon: LucideIcon };
type Category = { label: string; icon: LucideIcon; items: Item[] };

const categories: Category[] = [
  {
    label: 'Overview',
    icon: LayoutGrid,
    items: [
      { label: 'Dashboard', href: '/dashboard', icon: LayoutGrid },
      { label: 'Analytics', href: '/analytics', icon: BarChart3 },
    ],
  },
  {
    label: 'Users & Access',
    icon: Users,
    items: [
      { label: 'User Management', href: '/users', icon: Users },
      { label: 'KYC Review', href: '/kyc', icon: ShieldCheck },
      { label: 'Roles & Access', href: '/roles', icon: ShieldCheck },
    ],
  },
  {
    label: 'Transactions',
    icon: Activity,
    items: [
      { label: 'Transactions', href: '/transactions', icon: Activity },
      { label: 'Withdrawals Review', href: '/withdrawals', icon: Banknote },
      { label: 'Virtual Accounts', href: '/virtual-accounts', icon: CreditCard },
    ],
  },
  {
    label: 'Finance',
    icon: TrendingUp,
    items: [
      { label: 'Fees & Trading', href: '/trading-settings', icon: TrendingUp },
      { label: 'Crypto Wallets', href: '/crypto-wallets', icon: Wallet },
      { label: 'Adjust Balance', href: '/adjust-balance', icon: KeyRound },
    ],
  },
  {
    label: 'Bills',
    icon: Receipt,
    items: [
      { label: 'Bill Logos', href: '/bill-logos', icon: Receipt },
    ],
  },
  {
    label: 'Settings',
    icon: Settings,
    items: [
      { label: 'Feature Toggles', href: '/features', icon: ToggleLeft },
      { label: 'Payment Settings', href: '/payment-settings', icon: CreditCard },
      { label: 'Provider Settings', href: '/provider-settings', icon: Server },
      { label: 'Support Contact', href: '/support-contact', icon: MessageSquare },
      { label: 'Admin Profile', href: '/profile', icon: ShieldCheck },
    ],
  },
];

export default function Sidebar({ open = false, onClose }: { open?: boolean; onClose?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [pendingWithdrawals, setPendingWithdrawals] = useState(0);
  useEffect(() => {
    fetch('/api/auth')
      .then((r) => r.json())
      .then((d) => setEmail(d.email ?? null))
      .catch(() => {});
  }, []);
  // Live count of withdrawals awaiting review — surfaced as a nav badge so the
  // admin sees queued payouts the moment they open the dashboard.
  useEffect(() => {
    let active = true;
    const poll = () =>
      fetch('/api/withdrawals', { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : { withdrawals: [] }))
        .then((d) => { if (active) setPendingWithdrawals(Array.isArray(d.withdrawals) ? d.withdrawals.length : 0); })
        .catch(() => {});
    poll();
    const id = setInterval(poll, 60_000);
    return () => { active = false; clearInterval(id); };
  }, []);
  const logout = async () => {
    try {
      await fetch('/api/auth', { method: 'DELETE' });
    } finally {
      router.replace('/login');
    }
  };
  const [openCats, setOpenCats] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const c of categories) init[c.label] = true;
    return init;
  });
  const toggle = (label: string) => setOpenCats((s) => ({ ...s, [label]: !s[label] }));

  return (
    <>
      {open && (
        <div className="lg:hidden fixed inset-0 bg-black/40 z-40" onClick={onClose} aria-hidden="true" />
      )}

      <aside
        className={
          'w-64 bg-white border-r border-gray-200 h-screen fixed left-0 top-0 z-50 flex flex-col transform transition-transform duration-200 ease-in-out ' +
          (open ? 'translate-x-0' : '-translate-x-full') +
          ' lg:translate-x-0'
        }
      >
        <div className="shrink-0 p-6 border-b border-gray-200">
          <Image
            src="/cheqpay-logo.png"
            alt="CheqPay"
            width={180}
            height={75}
            priority
            className="h-auto w-[160px] brightness-0 invert"
          />
          <p className="mt-2 text-sm text-gray-500">Admin Panel</p>
        </div>

        <nav className="flex-1 min-h-0 overflow-y-auto p-3 space-y-1">
          {categories.map((cat) => {
            const CatIcon = cat.icon;
            const expanded = openCats[cat.label];
            const hasActive = cat.items.some((i) => i.href === pathname);
            return (
              <div key={cat.label}>
                <button
                  onClick={() => toggle(cat.label)}
                  className={
                    'w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-semibold uppercase tracking-wide transition-colors ' +
                    (hasActive ? 'text-brand-600' : 'text-gray-400 hover:text-gray-600')
                  }
                >
                  <span className="flex items-center gap-2">
                    <CatIcon size={14} />
                    {cat.label}
                  </span>
                  <ChevronDown
                    size={14}
                    className={'transition-transform ' + (expanded ? 'rotate-180' : '')}
                  />
                </button>

                {expanded && (
                  <div className="mt-1 space-y-1">
                    {cat.items.map((item) => {
                      const Icon = item.icon;
                      const active = pathname === item.href;
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          onClick={onClose}
                          className={
                            'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ' +
                            (active
                              ? 'bg-brand-50 text-brand-600'
                              : 'text-gray-700 hover:bg-brand-50 hover:text-brand-600')
                          }
                        >
                          <Icon size={18} />
                          <span className="flex-1">{item.label}</span>
                          {item.href === '/withdrawals' && pendingWithdrawals > 0 && (
                            <span className="ml-auto inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1.5 text-xs font-bold text-white">
                              {pendingWithdrawals}
                            </span>
                          )}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        <div className="shrink-0 p-4 border-t border-gray-200 bg-white">
          <div className="flex items-center gap-2">
            <Link
              href="/profile"
              onClick={onClose}
              className="flex flex-1 items-center gap-3 rounded-lg px-2 py-2 hover:bg-gray-50 transition-colors min-w-0"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-100 text-brand-600 font-bold">
                {(email || 'A').charAt(0).toUpperCase()}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-gray-900">
                  {email ?? 'Admin'}
                </span>
                <span className="block text-xs text-gray-500">View profile</span>
              </span>
            </Link>
            <button
              onClick={logout}
              aria-label="Logout"
              className="p-2.5 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
