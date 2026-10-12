import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "CheqPay Developers", template: "%s · CheqPay Developers" },
  description: "Build on CheqPay: wallets and virtual accounts for your customers, bill payments, and USD virtual cards, through one API.",
  metadataBase: new URL("https://developers.mycheqpay.com"),
  openGraph: {
    title: "CheqPay Developers",
    description: "Wallets, virtual accounts, bills and USD cards for your customers, through one API.",
    url: "https://developers.mycheqpay.com",
    siteName: "CheqPay Developers",
    images: ["/icon.png"],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F2F2F7" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans">{children}</body>
    </html>
  );
}
