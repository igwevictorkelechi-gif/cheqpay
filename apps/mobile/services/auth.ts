import { supabase } from './supabase';
import { User } from '@cheqpay/shared';
import type { User as SupabaseUser } from '@supabase/supabase-js';

/** Build the app User shape from a Supabase auth user + its metadata. */
function toUser(u: SupabaseUser): User {
  const meta = (u.user_metadata ?? {}) as { full_name?: string; phone?: string };
  return {
    id: u.id,
    email: u.email ?? '',
    phone: meta.phone ?? u.phone ?? '',
    full_name: meta.full_name ?? '',
    kyc_status: 'pending',
    referral_code: '',
    created_at: u.created_at ?? '',
    updated_at: u.updated_at ?? '',
  };
}

export const authService = {
  /**
   * Send a 6-digit email verification code (Supabase email OTP). For sign-up,
   * pass create=true plus the profile metadata to stamp onto the auth user.
   */
  async sendEmailOtp(
    email: string,
    opts?: { create?: boolean; fullName?: string; phone?: string }
  ) {
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: opts?.create ?? false,
          data: opts?.create
            ? { full_name: opts?.fullName ?? '', phone: opts?.phone ?? '' }
            : undefined,
        },
      });
      if (error) throw error;
      return { success: true };
    } catch (error) {
      console.error('Send email OTP error:', error);
      return { success: false, error };
    }
  },

  /** Verify the emailed code and establish the session. */
  async verifyEmailOtp(email: string, token: string) {
    try {
      const { data, error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
      if (error) throw error;
      return { success: true, data };
    } catch (error) {
      console.error('Verify email OTP error:', error);
      return { success: false, error };
    }
  },

  async getCurrentUser(): Promise<User | null> {
    try {
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser();
      if (error || !user) return null;
      return toUser(user);
    } catch (error) {
      console.error('Get current user error:', error);
      return null;
    }
  },

  async logout() {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      return { success: true };
    } catch (error) {
      console.error('Logout error:', error);
      return { success: false, error };
    }
  },

  async refreshSession() {
    try {
      const { error } = await supabase.auth.refreshSession();
      if (error) throw error;
      return { success: true };
    } catch (error) {
      console.error('Refresh session error:', error);
      return { success: false };
    }
  },
};
