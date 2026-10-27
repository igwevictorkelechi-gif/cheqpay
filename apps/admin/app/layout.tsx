import type { Metadata, Viewport } from 'next';
import './globals.css';
import SecurityGate from '@/components/SecurityGate';
import PwaSetup from '@/components/PwaSetup';

export const metadata: Metadata = {
  title: 'CheqPay Admin Dashboard',
  description: 'Manage your fintech operations with CheqPay',
  applicationName: 'CheqPay Admin',
  // Installed on an iPhone home screen, it opens full screen like an app.
  appleWebApp: { capable: true, title: 'CheqPay Admin', statusBarStyle: 'default' },
};

export const viewport: Viewport = {
  themeColor: '#ffffff',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-gray-50">
        {children}
        {/* Answers the backend's step-up prompts (authenticator code, reason,
            payout hash) on every page, and returns revoked sessions to login. */}
        <SecurityGate />
        {/* Installable app + alerts (service worker). */}
        <PwaSetup />
      </body>
    </html>
  );
}
