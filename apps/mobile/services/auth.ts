import { supabase } from './supabase';
import { User } from '@cheqpay/shared';

export const authService = {
  async sendOTP(phone: string) {
    try {
      // Call edge function to send OTP
      const { data, error } = await supabase.functions.invoke('send-otp', {
        body: { phone },
      });

      if (error) throw error;
      return { success: true, data };
    } catch (error) {
      console.error('Send OTP error:', error);
      return { success: false, error };
    }
  },

  async verifyOTP(phone: string, otpCode: string) {
    try {
      const { data, error } = await supabase.functions.invoke('verify-otp', {
        body: { phone, otp_code: otpCode },
      });

      if (error) throw error;

      // Store session
      if (data?.session) {
        await supabase.auth.setSession(data.session);
      }

      return { success: true, data };
    } catch (error) {
      console.error('Verify OTP error:', error);
      return { success: false, error };
    }
  },

  async register(
    phone: string,
    email: string,
    fullName: string,
    otpCode: string
  ) {
    try {
      const { data, error } = await supabase.functions.invoke('register', {
        body: {
          phone,
          email,
          full_name: fullName,
          otp_code: otpCode,
        },
      });

      if (error) throw error;
      return { success: true, data };
    } catch (error) {
      console.error('Register error:', error);
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

      // Fetch full user profile
      const { data, error: fetchError } = await supabase
        .from('users')
        .select('*')
        .eq('id', user.id)
        .single();

      if (fetchError) return null;
      return data;
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
