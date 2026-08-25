import type { Metadata, Viewport } from "next";
import "./globals.css";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";
import { SITE_URL } from "@/lib/site";
import InstallPrompt from "@/components/InstallPrompt";
import LockGate from "@/components/LockGate";
import AuthGuard from "@/components/AuthGuard";

export const metadata: Metadata = {
  // Every relative URL below (canonicals, OG images) resolves against this, and
  // without it Next emits relative social tags that crawlers cannot follow.
  metadataBase: new URL(SITE_URL),
  title: {
    default: "CheqPay — Send money, buy crypto and pay bills in Nigeria",
    // Per-page titles come from each route's layout.tsx and get the brand
    // appended here, so no page has to repeat it.
    template: "%s | CheqPay",
  },
  description:
    "CheqPay gives you a Naira account number, instant transfers to any Nigerian bank, " +
    "airtime, data, electricity and cable payments, and a simple way to buy and sell " +
    "Bitcoin and USDT — in one verified account.",
  applicationName: "CheqPay",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "CheqPay",
    locale: "en_NG",
    url: SITE_URL,
    title: "CheqPay — Send money, buy crypto and pay bills in Nigeria",
    description:
      "A Naira account number, transfers to any Nigerian bank, bill payments, and " +
      "Bitcoin and USDT you can buy and sell at rates you see first.",
    images: [{ url: "/cheqpay-logo.png", width: 1200, height: 630, alt: "CheqPay" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "CheqPay — Send money, buy crypto and pay bills in Nigeria",
    description:
      "A Naira account number, transfers to any Nigerian bank, bill payments, and " +
      "Bitcoin and USDT you can buy and sell at rates you see first.",
    images: ["/cheqpay-logo.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large" },
  },
  // `keywords` is deliberately gone: Google has ignored the meta keywords tag
  // since 2009, and leaving it invites people to tune a field nothing reads.
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "CheqPay",
  },
  icons: {
    icon: "/icon.png",
    apple: "/apple-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#14121A",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // suppressHydrationWarning: the pre-paint script below sets data-theme on
    // <html> before React hydrates, so the server markup and the client tree
    // intentionally differ on this one element.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/*
          Preload the latin subset only. It carries the alphabet and digits, so
          it is on the critical path for every screen; latin-ext holds the naira
          sign and is fetched by the same first paint that needs it. Preloading
          both would make the app pay for two files before rendering anything.
        */}
        <link
          rel="preload"
          href="/fonts/jakarta-latin-v1.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        {/* Apply the saved theme before first paint to avoid a flash. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{if(localStorage.getItem('cheqpay:theme')==='light')document.documentElement.setAttribute('data-theme','light')}catch(e){}",
          }}
        />
      </head>
      <body>
        <AuthGuard>
          <div className="min-h-screen">{children}</div>
        </AuthGuard>
        <LockGate />
        <InstallPrompt />
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
