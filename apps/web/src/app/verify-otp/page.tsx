"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import AuthLayout from "@/components/AuthLayout";
import { authService } from "@/services/auth";
import { api } from "@/services/api";
import { useAuthStore } from "@/store";

function VerifyOTPForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setUser, setLoading: setAuthLoading } = useAuthStore();

  const type = searchParams.get("type") || "login";
  const fullName = searchParams.get("fullName") || "";
  const email = searchParams.get("email") || "";

  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [resendTimer, setResendTimer] = useState(0);

  useEffect(() => {
    if (resendTimer > 0) {
      const timer = setTimeout(() => setResendTimer(resendTimer - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [resendTimer]);

  const handleVerifyOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    if (otp.length < 6) {
      setError("Enter the code from your email");
      setLoading(false);
      return;
    }

    try {
      const verified = await authService.verifyEmailOtp(email, otp);
      if (!verified) {
        setError("Invalid or expired code. Please try again.");
        return;
      }
      // Ensure the custodial backend profile + wallets exist.
      try {
        await api.ensureProvisioned();
      } catch {
        /* non-fatal — screens re-provision on demand */
      }
      const user = await authService.getCurrentUser();
      if (user) setUser(user);
      // New sign-ups continue onboarding (identity + PIN); logins go home.
      router.push(type === "signup" ? "/onboarding" : "/");
    } catch (err) {
      setError("Invalid or expired code. Please try again.");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleResendOTP = async () => {
    try {
      await authService.sendEmailOtp(email, { create: type === "signup", fullName });
      setResendTimer(60);
      setOtp("");
    } catch (err) {
      setError("Failed to resend the code");
      console.error(err);
    }
  };

  return (
    <AuthLayout>
      <div className="p-8">
        <h2 className="text-2xl font-bold text-ink">Verify your email</h2>
        <p className="mt-2 text-sm text-muted">
          Enter the 6-digit code sent to <span className="font-semibold">{email}</span>
        </p>

        <form onSubmit={handleVerifyOTP} className="mt-6 space-y-4">
          <div>
            <label className="label">OTP Code</label>
            <input
              type="text"
              value={otp}
              onChange={(e) => {
                const value = e.target.value.replace(/\D/g, "").slice(0, 10);
                setOtp(value);
              }}
              placeholder="000000"
              maxLength={10}
              inputMode="numeric"
              className="input text-center text-2xl font-bold tracking-widest"
              disabled={loading}
            />
            <p className="mt-1 text-xs text-gray-500">
              Enter the code you received via email
            </p>
          </div>

          {error && (
            <div className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || otp.length < 6}
            className="btn-primary w-full"
          >
            {loading ? "Verifying..." : "Verify OTP"}
          </button>
        </form>

        <div className="mt-6 border-t border-gray-200 pt-6 text-center">
          <p className="text-sm text-gray-600">Didn&apos;t receive the code?</p>
          <button
            onClick={handleResendOTP}
            disabled={resendTimer > 0}
            className="mt-2 font-medium text-primary hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {resendTimer > 0 ? `Resend in ${resendTimer}s` : "Resend OTP"}
          </button>
        </div>
      </div>
    </AuthLayout>
  );
}

export default function VerifyOTPPage() {
  return (
    <Suspense fallback={null}>
      <VerifyOTPForm />
    </Suspense>
  );
}
