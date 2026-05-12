"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import AuthLayout from "@/components/AuthLayout";
import { authService } from "@/services/auth";
import { useAuthStore } from "@/store";

export default function LoginPage() {
  const router = useRouter();
  const { setLoading } = useAuthStore();
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [loading, setLocalLoading] = useState(false);

  const handleSendOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLocalLoading(true);

    // Validate phone
    const phoneRegex = /^(\+234|0)[0-9]{10}$/;
    if (!phoneRegex.test(phone.replace(/\s/g, ""))) {
      setError("Please enter a valid Nigerian phone number");
      setLocalLoading(false);
      return;
    }

    try {
      await authService.sendOTP(phone);
      router.push(`/verify-otp?phone=${encodeURIComponent(phone)}&type=login`);
    } catch (err) {
      setError("Failed to send OTP. Please try again.");
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
          Enter your phone number to get started
        </p>

        <form onSubmit={handleSendOTP} className="mt-6 space-y-4">
          <div>
            <label className="label">Phone Number</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+234 81 2345 6789"
              className="input"
              disabled={loading}
            />
            <p className="mt-1 text-xs text-gray-500">
              Include country code (+234 or 0)
            </p>
          </div>

          {error && (
            <div className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !phone.trim()}
            className="btn-primary w-full"
          >
            {loading ? "Sending OTP..." : "Send OTP"}
          </button>
        </form>

        <div className="mt-6 border-t border-gray-200 pt-6">
          <p className="text-center text-sm text-gray-600">
            Don't have an account?{" "}
            <Link href="/signup" className="font-medium text-primary hover:underline">
              Sign up
            </Link>
          </p>
        </div>
      </div>
    </AuthLayout>
  );
}
