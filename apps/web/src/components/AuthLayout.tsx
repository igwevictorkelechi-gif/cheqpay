interface AuthLayoutProps {
  children: React.ReactNode;
}

export default function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/10 via-white to-primary-light/20 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="mb-8 text-center">
          <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-primary">
            <span className="text-white font-bold text-2xl">₦</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">CheqPay</h1>
          <p className="mt-2 text-sm text-gray-600">
            Your trusted Nigerian fintech platform
          </p>
        </div>

        {/* Content */}
        <div className="rounded-2xl bg-white shadow-xl">{children}</div>

        {/* Footer */}
        <p className="mt-6 text-center text-sm text-gray-500">
          © 2024 CheqPay. All rights reserved.
        </p>
      </div>
    </div>
  );
}
