"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ShieldCheck, Loader2 } from "lucide-react";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // Second step: shown once the password is accepted and an authenticator is
  // enrolled. The password alone no longer opens the dashboard.
  const [needsOtp, setNeedsOtp] = useState(false);
  const [otp, setOtp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, ...(needsOtp ? { otp } : {}) }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (body.code === "otp_required" || body.code === "bad_otp") {
          setNeedsOtp(true);
          setOtp("");
          setError(body.code === "bad_otp" ? body.error : null);
          return;
        }
        setError(body.error || "Login failed");
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { mustChangePassword?: boolean };
      // A sub admin on their starting password sets their own before anything else.
      const safeNext = /^\/(?![/\\])/.test(next) ? next : "/";
      router.replace(data.mustChangePassword ? "/account/password" : safeNext);
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-100 text-brand-600">
            <ShieldCheck size={24} />
          </span>
          <h1 className="text-xl font-bold text-gray-900">CheqPay Admin</h1>
          <p className="mt-1 text-sm text-gray-500">Sign in with your admin account</p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@cheqpay.com"
            autoFocus
            autoComplete="email"
            className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoComplete="current-password"
            className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
          />
          {needsOtp && (
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">
                Code from your authenticator app
              </label>
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="123456"
                autoFocus
                className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-center font-mono text-lg tracking-[0.4em] outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
              />
            </div>
          )}
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={loading || !email || !password || (needsOtp && otp.length !== 6)}
            className="flex w-full items-center justify-center rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : needsOtp ? "Verify & sign in" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function AdminLoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
