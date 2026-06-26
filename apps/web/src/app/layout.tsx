import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CheqPay - Nigerian Fintech",
  description: "Send money, pay bills, and manage your wallet securely",
  keywords: ["fintech", "payments", "wallet", "nigeria"],
  viewport: "width=device-width, initial-scale=1, maximum-scale=1",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
      </head>
      <body>
        <div className="min-h-screen">
          {children}
        </div>
      </body>
    </html>
  );
}
