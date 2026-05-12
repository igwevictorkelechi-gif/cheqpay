import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Cheqpay Admin Dashboard',
  description: 'Manage your fintech operations with Cheqpay',
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
      </body>
    </html>
  );
}
