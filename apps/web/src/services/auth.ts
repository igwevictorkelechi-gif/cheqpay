import { supabase } from "./supabase";
import type { User } from "@cheqpay/shared";

export const authService = {
  async sendOTP(phone: string) {
    try {
      const response = await fetch("/api/auth/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });

      if (!response.ok) throw new Error("Failed to send OTP");
      return await response.json();
    } catch (error) {
      console.error("sendOTP error:", error);
      throw error;
    }
  },

  async verifyOTP(phone: string, otpCode: string) {
    try {
      const response = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, otp_code: otpCode }),
      });

      if (!response.ok) throw new Error("Failed to verify OTP");
      const data = await response.json();
      return data;
    } catch (error) {
      console.error("verifyOTP error:", error);
      throw error;
    }
  },

  async register(
    phone: string,
    email: string,
    fullName: string,
    otpCode: string
  ) {
    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone,
          email,
          full_name: fullName,
          otp_code: otpCode,
        }),
      });

      if (!response.ok) throw new Error("Registration failed");
      const data = await response.json();
      return data;
    } catch (error) {
      console.error("register error:", error);
      throw error;
    }
  },

  async getCurrentUser(): Promise<User | null> {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return null;

      const { data } = await supabase
        .from("users")
        .select("*")
        .eq("id", session.user.id)
        .single();

      return data;
    } catch (error) {
      console.error("getCurrentUser error:", error);
      return null;
    }
  },

  async logout() {
    try {
      await supabase.auth.signOut();
    } catch (error) {
      console.error("logout error:", error);
      throw error;
    }
  },

  async refreshSession() {
    try {
      const {
        data: { session },
      } = await supabase.auth.refreshSession();
      return session;
    } catch (error) {
      console.error("refreshSession error:", error);
      throw error;
    }
  },
};
