import { useState } from 'react';
import { View, Text, TouchableOpacity, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { authService } from '@/services/auth';
import { colors } from '@/components/brand';
import { AuthShell, AuthTitle, AuthField, AuthButton, AuthError, AuthFooter } from '@/components/auth';

const TERMS_URL = 'https://mycheqpay.com/terms';
const PRIVACY_URL = 'https://mycheqpay.com/privacy';

export default function SignupScreen() {
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSendOTP = async () => {
    setError('');
    const address = email.trim().toLowerCase();
    if (!fullName || fullName.trim().length < 2) {
      setError('Please enter your full name.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      setError('Please enter a valid email address.');
      return;
    }
    if (!agreed) {
      setError('Please agree to the Terms of Service and Privacy Policy to create your account.');
      return;
    }

    setLoading(true);
    try {
      const result = await authService.sendEmailOtp(address, {
        create: true,
        fullName: fullName.trim(),
        phone: phone.trim(),
      });
      if (result.success) {
        router.push({
          pathname: '/(auth)/verify-otp',
          params: { email: address, fullName, isSignup: '1' },
        });
      } else {
        setError('Could not send the code. Please try again.');
      }
    } catch {
      setError('Could not send the code. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell>
      <AuthTitle title="Create Account" subtitle="Join CheqPay and start managing your finances" />
      <AuthField label="Full name" placeholder="John Doe" value={fullName} onChangeText={setFullName} editable={!loading} autoComplete="name" />
      <AuthField
        label="Email"
        placeholder="you@example.com"
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        value={email}
        onChangeText={setEmail}
        editable={!loading}
      />
      <AuthField
        label="Phone number (optional)"
        placeholder="08012345678"
        keyboardType="phone-pad"
        value={phone}
        onChangeText={setPhone}
        editable={!loading}
      />

      <TouchableOpacity
        style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 16, marginTop: 2 }}
        activeOpacity={0.7}
        onPress={() => setAgreed((v) => !v)}
        disabled={loading}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: agreed }}
      >
        <View
          style={{
            width: 20,
            height: 20,
            borderRadius: 6,
            marginTop: 1,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 1.5,
            borderColor: agreed ? colors.brand : colors.border,
            backgroundColor: agreed ? colors.brand : 'transparent',
          }}
        >
          {agreed && <Ionicons name="checkmark" size={14} color="#fff" />}
        </View>
        <Text style={{ flex: 1, marginLeft: 10, fontSize: 13, lineHeight: 19, color: colors.muted }}>
          I agree to CheqPay&apos;s{' '}
          <Text style={{ color: colors.brandLight, fontWeight: '600' }} onPress={() => Linking.openURL(TERMS_URL).catch(() => undefined)}>
            Terms of Service
          </Text>{' '}
          and{' '}
          <Text style={{ color: colors.brandLight, fontWeight: '600' }} onPress={() => Linking.openURL(PRIVACY_URL).catch(() => undefined)}>
            Privacy Policy
          </Text>
          , including the collection of my identity information for verification.
        </Text>
      </TouchableOpacity>

      <AuthError message={error} />
      <AuthButton label="Create Account" onPress={handleSendOTP} loading={loading} />
      <AuthFooter prompt="Already have an account?" action="Sign in" onPress={() => router.push('/(auth)/login')} />
    </AuthShell>
  );
}
