import type { Metadata, Viewport } from "next";
import "./globals.css";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";
import InstallPrompt from "@/components/InstallPrompt";
import LockGate from "@/components/LockGate";
import AuthGuard from "@/components/AuthGuard";

export const metadata: Metadata = {
  title: "CheqPay - Beyond Finance",
  description: "Send money, buy & sell crypto, and pay bills.",
  keywords: ["fintech", "payments", "wallet", "crypto", "nigeria"],
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
