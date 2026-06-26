"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import AuthLayout from "@/components/AuthLayout";
import { authService } from "@/services/auth";

export default function SignupPage() {
  const router = useRouter();
  const [formData, setFormData] = useState({
    fullName: "",
    email: "",
    phone: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  const handleSendOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    // Validate fields
    if (formData.fullName.length < 2) {
      setError("Full name must be at least 2 characters");
      setLoading(false);
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formData.email)) {
      setError("Please enter a valid email address");
      setLoading(false);
      return;
    }

    const phoneRegex = /^(\+234|0)[0-9]{10}$/;
    if (!phoneRegex.test(formData.phone.replace(/\s/g, ""))) {
      setError("Please enter a valid Nigerian phone number");
      setLoading(false);
      return;
    }

    try {
      await authService.sendOTP(formData.phone);
      const params = new URLSearchParams({
        phone: formData.phone,
        fullName: formData.fullName,
        email: formData.email,
        type: "signup",
      });
      router.push(`/verify-otp?${params}`);
    } catch (err) {
      setError("Failed to send OTP. Please try again.");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout>
      <div className="p-8">
        <h2 className="text-2xl font-bold text-gray-900">Create Account</h2>
        <p className="mt-2 text-sm text-gray-600">
          Join CheqPay and start managing your money
        </p>

        <form onSubmit={handleSendOTP} className="mt-6 space-y-4">
          <div>
            <label className="label">Full Name</label>
            <input
              type="text"
              name="fullName"
              value={formData.fullName}
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
              value={formData.email}
              onChange={handleChange}
              placeholder="john@example.com"
              className="input"
              disabled={loading}
            />
          </div>

          <div>
            <label className="label">Phone Number</label>
            <input
              type="tel"
              name="phone"
              value={formData.phone}
              onChange={handleChange}
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
            disabled={loading || !formData.fullName || !formData.email || !formData.phone}
            className="btn-primary w-full"
          >
            {loading ? "Sending OTP..." : "Continue"}
          </button>
        </form>

        <div className="mt-6 border-t border-gray-200 pt-6">
          <p className="text-center text-sm text-gray-600">
            Already have an account?{" "}
            <Link href="/login" className="font-medium text-primary hover:underline">
              Login
            </Link>
          </p>
        </div>
      </div>
    </AuthLayout>
  );
}
