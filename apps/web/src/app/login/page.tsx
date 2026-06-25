"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import AuthLayout from "@/components/AuthLayout";
import { authService } from "@/services/auth";
import { useAuthStore, useWalletStore } from "@/store";
import {
  demoUser,
  demoWallet,
  demoVirtualAccount,
  demoTransactions,
} from "@/lib/demo";

export default function LoginPage() {
  const router = useRouter();
  const { setLoading, setUser } = useAuthStore();
  const { setWallet, setVirtualAccount, setTransactions } = useWalletStore();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLocalLoading] = useState(false);

  const continueAsDemo = () => {
    setUser(demoUser);
    setWallet(demoWallet);
    setVirtualAccount(demoVirtualAccount);
    setTransactions(demoTransactions);
    setLoading(false);
    router.push("/");
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLocalLoading(true);
    try {
      const user = await authService.signInWithEmail(email.trim(), password);
      if (!user) {
        setError("Could not sign you in. Please check your details.");
        return;
      }
      setUser(user);
      setLoading(false);
      router.push("/");
    } catch (err) {
      setError("Invalid email or password.");
      console.error(err);
    } finally {
      setLocalLoading(false);
    }
  };

  return (
    <AuthLayout>
      <div className="p-8">
        <h2 className="text-2xl font-bold text-gray-900">Welcome Back</h2>
        <p className="mt-2 text-sm text-gray-600">
          Sign in to your Cheqpay account
        </p>

        <form onSubmit={handleSignIn} className="mt-6 space-y-4">
          <div>
            <label className="label">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="input"
              disabled={loading}
              autoComplete="email"
            />
          </div>

          <div>
            <label className="label">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="input"
              disabled={loading}
              autoComplete="current-password"
            />
          </div>

          {error && (
            <div className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !email.trim() || !password}
            className="btn-primary w-full"
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>

        <button
          type="button"
          onClick={continueAsDemo}
          className="btn-secondary mt-3 w-full"
        >
          Continue as demo user
        </button>

        <div className="mt-6 border-t border-gray-200 pt-6">
          <p className="text-center text-sm text-gray-600">
            Don&apos;t have an account?{" "}
            <Link href="/signup" className="font-medium text-primary hover:underline">
              Sign up
            </Link>
          </p>
        </div>
      </div>
    </AuthLayout>
  );
}
