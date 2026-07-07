import Image from "next/image";

interface AuthLayoutProps {
  children: React.ReactNode;
}

export default function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-black p-4">
      <div
        className="w-full max-w-md rounded-[28px] p-1"
        style={{
          background:
            "radial-gradient(120% 120% at 50% 0%, rgba(138,123,181,0.25) 0%, rgba(20,18,26,0) 60%)",
        }}
      >
        {/* Logo */}
        <div className="mb-8 mt-2 flex flex-col items-center">
          <Image
            src="/cheqpay-icon.png"
            alt="CheqPay"
            width={72}
            height={72}
            priority
            className="h-16 w-16 rounded-2xl"
          />
          <p className="mt-3 text-2xl font-extrabold tracking-tight text-ink">CheqPay</p>
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted">
            Beyond Finance
          </p>
        </div>

        {/* Content */}
        <div className="rounded-3xl border border-border bg-card shadow-xl">{children}</div>

        {/* Footer */}
        <p className="mt-6 text-center text-sm text-muted">
          © 2026 CheqPay. All rights reserved.
        </p>
        <p className="mt-1 text-center text-xs text-muted">
          App ID Version 1.1 by Boli Labs Limited
        </p>
      </div>
    </div>
  );
}
