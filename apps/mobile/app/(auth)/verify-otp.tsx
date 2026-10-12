import { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { router } from 'expo-router';
import { useAuthStore } from '@/store';
import { authService } from '@/services/auth';
import { api } from '@/services/api';
import { colors } from '@/components/brand';
import { AuthShell, AuthTitle, AuthField, AuthButton, AuthError } from '@/components/auth';

export default function VerifyOTPScreen() {
  const route = useRoute();
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [resendTimer, setResendTimer] = useState(60);
  const [canResend, setCanResend] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const { email, isSignup } = route.params as { email: string; fullName?: string; isSignup?: string };
  const signingUp = !!isSignup;

  const { setUser, setIsAuthenticated } = useAuthStore();

  useEffect(() => {
    const timer = setInterval(() => {
      setResendTimer((prev) => {
        if (prev <= 1) {
          setCanResend(true);
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const handleVerifyOTP = async () => {
    setError('');
    if (!otp || otp.length < 6) {
      setError('Please enter the code from your email.');
      return;
    }

    setLoading(true);
    try {
      const result = await authService.verifyEmailOtp(email, otp);
      if (!result.success) {
        setError('Invalid or expired code. Please try again.');
        return;
      }

      // The session is now established. Mark authenticated immediately so the
      // root route guard doesn't bounce us to /login while we finish the async
      // provisioning below (which would skip onboarding entirely).
      setIsAuthenticated(true);

      // Ensure the custodial backend profile + wallets exist.
      try {
        await api.ensureProvisioned();
      } catch {
        /* non-fatal — screens re-provision on demand */
      }

      const user = await authService.getCurrentUser();
      if (user) setUser(user);

      // Route by KYC status: anyone not yet verified (tier < 2) goes through
      // onboarding (identity check + PIN); verified users go straight home.
      let tier = 0;
      try {
        tier = (await api.getKyc()).kycTier;
      } catch {
        /* default to onboarding on any error */
      }
      router.replace(tier >= 2 ? '/(app)/home' : '/(app)/onboarding');
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleResendOTP = async () => {
    setCanResend(false);
    setResendTimer(60);
    setError('');
    setNotice('');
    try {
      await authService.sendEmailOtp(email, { create: signingUp });
      setNotice('A new code is on its way to your email.');
    } catch {
      setError('Failed to resend the code. Please try again.');
    }
  };

  return (
    <AuthShell>
      <AuthTitle
        title="Verify your email"
        subtitle={
          <>
            Enter the 6-digit code sent to <Text style={{ fontWeight: '600', color: colors.ink }}>{email}</Text>
          </>
        }
      />
      <AuthField
        label="OTP Code"
        placeholder="000000"
        keyboardType="number-pad"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        value={otp}
        onChangeText={(text) => setOtp(text.replace(/\D/g, '').slice(0, 10))}
        maxLength={10}
        editable={!loading}
        onSubmitEditing={handleVerifyOTP}
        style={{ textAlign: 'center', fontSize: 24, fontWeight: '700', letterSpacing: 6 }}
      />
      <AuthError message={error} />
      {notice ? <Text style={{ marginBottom: 14, fontSize: 13, color: colors.positive }}>{notice}</Text> : null}
      <AuthButton label="Verify" onPress={handleVerifyOTP} loading={loading} disabled={otp.length < 6} />

      <View style={{ marginTop: 22, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 20, alignItems: 'center' }}>
        <Text style={{ fontSize: 13, color: colors.muted }}>Didn&apos;t receive the code?</Text>
        {canResend ? (
          <TouchableOpacity onPress={handleResendOTP} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Text style={{ marginTop: 8, fontSize: 14, fontWeight: '500', color: colors.brandLight }}>Resend code</Text>
          </TouchableOpacity>
        ) : (
          <Text style={{ marginTop: 8, fontSize: 14, color: colors.muted }}>
            Resend code in <Text style={{ fontWeight: '700', color: colors.ink }}>{resendTimer}s</Text>
          </Text>
        )}
      </View>
    </AuthShell>
  );
}
