import { useState } from 'react';
import { router } from 'expo-router';
import { authService } from '@/services/auth';
import { AuthShell, AuthTitle, AuthField, AuthButton, AuthError, AuthFooter } from '@/components/auth';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSendOTP = async () => {
    setError('');
    const address = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      setError('Please enter a valid email address.');
      return;
    }

    setLoading(true);
    try {
      const result = await authService.sendEmailOtp(address, { create: false });
      if (result.success) {
        router.push({ pathname: '/(auth)/verify-otp', params: { email: address, isSignup: '' } });
      } else {
        setError('Could not send the code. Check the email and try again.');
      }
    } catch {
      setError('Could not send the code. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell>
      <AuthTitle title="Welcome Back" subtitle="Sign in with a code sent to your email" />
      <AuthField
        label="Email"
        placeholder="you@example.com"
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        value={email}
        onChangeText={setEmail}
        editable={!loading}
        onSubmitEditing={handleSendOTP}
      />
      <AuthError message={error} />
      <AuthButton label="Send code" onPress={handleSendOTP} loading={loading} disabled={!email.trim()} />
      <AuthFooter prompt="Don’t have an account?" action="Sign up" onPress={() => router.push('/(auth)/signup')} />
    </AuthShell>
  );
}
