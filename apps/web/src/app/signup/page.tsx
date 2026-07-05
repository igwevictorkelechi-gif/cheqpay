"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import AuthLayout from "@/components/AuthLayout";
import { authService } from "@/services/auth";

export default function SignupPage() {
  const router = useRouter();
  const [form, setForm] = useState({ fullName: "", email: "", phone: "" });
  const [error, setError] = useState("");
  const [loading, setLocalLoading] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [e.target.name]: e.target.value });

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (form.fullName.trim().length < 2) {
      setError("Full name must be at least 2 characters");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      setError("Please enter a valid email address");
      return;
    }

    setLocalLoading(true);
    try {
      const email = form.email.trim().toLowerCase();
      await authService.sendEmailOtp(email, {
        create: true,
        fullName: form.fullName.trim(),
        phone: form.phone.trim(),
      });
      router.push(
        `/verify-otp?type=signup&email=${encodeURIComponent(email)}&fullName=${encodeURIComponent(form.fullName.trim())}`
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Sign up failed";
      setError(message);
      console.error(err);
    } finally {
      setLocalLoading(false);
    }
  };

  return (
    <AuthLayout>
      <div className="p-8">
        <h2 className="text-2xl font-bold text-ink">Create Account</h2>
        <p className="mt-2 text-sm text-muted">
          Join CheqPay and start managing your money
        </p>

        <form onSubmit={handleSignup} className="mt-6 space-y-4">
          <div>
            <label className="label">Full Name</label>
            <input
              type="text"
              name="fullName"
              value={form.fullName}
              onChange={handleChange}
              placeholder="John Doe"
              className="input"
              disabled={loading}
            />
          </div>

          <div>
            <label className="label">Email Address</label>
            <input
              type="email"
              name="email"
              value={form.email}
              onChange={handleChange}
              placeholder="john@example.com"
              className="input"
              disabled={loading}
              autoComplete="email"
            />
          </div>

          <div>
            <label className="label">Phone Number (optional)</label>
            <input
              type="tel"
              name="phone"
              value={form.phone}
              onChange={handleChange}
              placeholder="08012345678"
              className="input"
              disabled={loading}
              autoComplete="tel"
            />
          </div>

          {error && (
            <div className="rounded-lg bg-red-500/10 p-3 text-sm text-red-400">{error}</div>
          )}

          <button
            type="submit"
            disabled={loading || !form.fullName || !form.email}
            className="btn-primary w-full"
          >
            {loading ? "Sending code..." : "Create Account"}
          </button>
        </form>

        <div className="mt-6 border-t border-border pt-6">
          <p className="text-center text-sm text-muted">
            Already have an account?{" "}
            <Link href="/login" className="font-semibold text-brand-light hover:underline">
              Login
            </Link>
          </p>
        </div>
      </div>
    </AuthLayout>
  );
}
