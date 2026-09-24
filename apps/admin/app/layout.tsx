import type { Metadata } from 'next';
import './globals.css';
import SecurityGate from '@/components/SecurityGate';

export const metadata: Metadata = {
  title: 'CheqPay Admin Dashboard',
  description: 'Manage your fintech operations with CheqPay',
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
      </body>
    </html>
  );
}
