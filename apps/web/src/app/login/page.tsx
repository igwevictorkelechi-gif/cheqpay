"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import AuthLayout from "@/components/AuthLayout";
import { authService } from "@/services/auth";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLocalLoading] = useState(false);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("Please enter a valid email address.");
      return;
    }
    setLocalLoading(true);
    try {
      await authService.sendEmailOtp(email.trim().toLowerCase(), { create: false });
      router.push(`/verify-otp?type=login&email=${encodeURIComponent(email.trim().toLowerCase())}`);
    } catch (err) {
      setError("Could not send the code. Please try again.");
      console.error(err);
    } finally {
      setLocalLoading(false);
    }
  };

  return (
    <AuthLayout>
      <div className="p-8">
        <h2 className="text-2xl font-bold text-ink">Welcome Back</h2>
        <p className="mt-2 text-sm text-muted">
          Sign in with a code sent to your email
        </p>

        <form onSubmit={handleSignIn} className="mt-6 space-y-4">
          <div>
            <label htmlFor="email" className="label">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="input"
              disabled={loading}
              autoComplete="email"
            />
          </div>

          {error && (
            <div className="rounded-lg bg-red-500/10 p-3 text-sm text-red-400">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !email.trim()}
            className="btn-primary w-full"
          >
            {loading ? "Sending code..." : "Send code"}
          </button>
        </form>

        <div className="mt-6 border-t border-border pt-6">
          <p className="text-center text-sm text-muted">
            Don&apos;t have an account?{" "}
            <Link href="/signup" className="font-semibold text-brand-light hover:underline">
              Sign up
            </Link>
          </p>
        </div>
      </div>
    </AuthLayout>
  );
}
