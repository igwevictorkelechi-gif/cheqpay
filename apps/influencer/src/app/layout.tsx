import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CheqPay Creators — earn with CheqPay",
  description: "Join the CheqPay influencer program. Share your link, and earn on every transaction your audience makes.",
  metadataBase: new URL("https://influencer.mycheqpay.com"),
  openGraph: {
    title: "CheqPay Creators",
    description: "Share your link. Earn on every transaction your audience makes.",
    url: "https://influencer.mycheqpay.com",
    siteName: "CheqPay Creators",
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
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans">{children}</body>
    </html>
  );
}
