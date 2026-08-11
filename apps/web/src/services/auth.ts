import { supabase } from "./supabase";
import type { User } from "@cheqpay/shared";
import type { User as SupabaseUser } from "@supabase/supabase-js";

/** Build an app User from a Supabase auth user (when no legacy profile row exists). */
function toUser(su: SupabaseUser, fullName?: string): User {
  const meta = (su.user_metadata ?? {}) as { full_name?: string };
  return {
    id: su.id,
    email: su.email ?? "",
    phone: su.phone ?? "",
    full_name: fullName ?? meta.full_name ?? su.email?.split("@")[0] ?? "",
    kyc_status: "pending",
    referral_code: "",
    created_at: su.created_at ?? new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

export const authService = {
  async signInWithEmail(email: string, password: string): Promise<User | null> {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;
    if (!data.session || !data.user) return null;

    // Prefer the legacy profile row if present; otherwise derive from session.
    const { data: profile } = await supabase
      .from("users")
      .select("*")
      .eq("id", data.user.id)
      .single();
    return profile ?? toUser(data.user);
  },

  /** Create an account with email + password (no SMS needed). */
  async signUpWithEmail(
    email: string,
    password: string,
    fullName: string
  ): Promise<{ user: User | null; needsConfirmation: boolean }> {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    });
    if (error) throw error;
    if (data.session && data.user) {
      return { user: toUser(data.user, fullName), needsConfirmation: false };
    }
    return { user: null, needsConfirmation: true };
  },

  /**
   * Send a 6-digit email verification code (Supabase email OTP). For sign-up,
   * pass create=true plus the profile metadata to stamp onto the auth user.
   */
  async sendEmailOtp(
    email: string,
    opts?: { create?: boolean; fullName?: string; phone?: string }
  ): Promise<void> {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: opts?.create ?? false,
        data: opts?.create
          ? { full_name: opts?.fullName ?? "", phone: opts?.phone ?? "" }
          : undefined,
      },
    });
    if (error) throw error;
  },

  /** Verify the emailed code and establish the session. */
  async verifyEmailOtp(email: string, token: string): Promise<User | null> {
    const { data, error } = await supabase.auth.verifyOtp({
      email,
      token,
      type: "email",
    });
    if (error) throw error;
    return data.user ? toUser(data.user) : null;
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

      return data ?? toUser(session.user);
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
