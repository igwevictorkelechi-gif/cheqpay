"use client";

import AppShell from "./AppShell";

interface MainLayoutProps {
  children: React.ReactNode;
}

/**
 * Wraps secondary pages (send, withdraw, settings, transactions, kyc) in the
 * same phone-shaped shell + bottom tab bar used by the rebranded screens.
 * The old desktop side navigation (Sidebar/Header) has been removed in
 * favour of the bottom nav.
 */
export default function MainLayout({ children }: MainLayoutProps) {
  return (
    <AppShell>
      <div className="px-4 py-4">{children}</div>
    </AppShell>
  );
}
