import Image from "next/image";

interface AuthLayoutProps {
  children: React.ReactNode;
}

export default function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/10 via-white to-primary-light/20 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="mb-8 text-center">
          <Image
            src="/cheqpay-logo.png"
            alt="CheqPay — Beyond Finance"
            width={280}
            height={117}
            priority
            className="mx-auto h-auto w-[240px]"
          />
        </div>

        {/* Content */}
        <div className="rounded-2xl bg-white shadow-xl">{children}</div>

        {/* Footer */}
        <p className="mt-6 text-center text-sm text-gray-500">
          © 2026 CheqPay. All rights reserved.
        </p>
      </div>
    </div>
  );
}
