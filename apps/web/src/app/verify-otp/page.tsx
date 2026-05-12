"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import AuthLayout from "@/components/AuthLayout";
import { authService } from "@/services/auth";
import { useAuthStore } from "@/store";

export default function VerifyOTPPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setUser, setLoading: setAuthLoading } = useAuthStore();

  const phone = searchParams.get("phone") || "";
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

    if (otp.length !== 6) {
      setError("OTP must be 6 digits");
      setLoading(false);
      return;
    }

    try {
      if (type === "signup") {
        await authService.register(phone, email, fullName, otp);
      } else {
        await authService.verifyOTP(phone, otp);
      }

      const user = await authService.getCurrentUser();
      if (user) {
        setUser(user);
        router.push("/");
      }
    } catch (err) {
      setError("Invalid OTP. Please try again.");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleResendOTP = async () => {
    try {
      await authService.sendOTP(phone);
      setResendTimer(60);
      setOtp("");
    } catch (err) {
      setError("Failed to resend OTP");
      console.error(err);
    }
  };

  return (
    <AuthLayout>
      <div className="p-8">
        <h2 className="text-2xl font-bold text-gray-900">Verify OTP</h2>
        <p className="mt-2 text-sm text-gray-600">
          Enter the 6-digit code sent to {phone}
        </p>

        <form onSubmit={handleVerifyOTP} className="mt-6 space-y-4">
          <div>
            <label className="label">OTP Code</label>
            <input
              type="text"
              value={otp}
              onChange={(e) => {
                const value = e.target.value.replace(/\D/g, "").slice(0, 6);
                setOtp(value);
              }}
              placeholder="000000"
              maxLength={6}
              className="input text-center text-2xl font-bold tracking-widest"
              disabled={loading}
            />
            <p className="mt-1 text-xs text-gray-500">
              Enter the code you received via SMS
            </p>
          </div>

          {error && (
            <div className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || otp.length !== 6}
            className="btn-primary w-full"
          >
            {loading ? "Verifying..." : "Verify OTP"}
          </button>
        </form>

        <div className="mt-6 border-t border-gray-200 pt-6 text-center">
          <p className="text-sm text-gray-600">Didn't receive the code?</p>
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
