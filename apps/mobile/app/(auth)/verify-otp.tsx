import { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useRoute } from '@react-navigation/native';
import { router } from 'expo-router';
import { useAuthStore } from '@/store';
import { authService } from '@/services/auth';
import { api } from '@/services/api';

export default function VerifyOTPScreen() {
  const route = useRoute();
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [resendTimer, setResendTimer] = useState(60);
  const [canResend, setCanResend] = useState(false);

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
    if (!otp || otp.length < 6) {
      Alert.alert('Error', 'Please enter the code from your email');
      return;
    }

    setLoading(true);
    try {
      const result = await authService.verifyEmailOtp(email, otp);
      if (!result.success) {
        Alert.alert('Error', 'Invalid or expired code. Please try again.');
        return;
      }

      // Ensure the custodial backend profile + wallets exist.
      try {
        await api.ensureProvisioned();
      } catch {
        /* non-fatal — screens re-provision on demand */
      }

      const user = await authService.getCurrentUser();
      if (user) {
        setUser(user);
        setIsAuthenticated(true);
      }
      // New sign-ups continue onboarding (identity + PIN); logins go home.
      router.replace(signingUp ? '/(app)/onboarding' : '/(app)/home');
    } catch (error) {
      Alert.alert('Error', 'An error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleResendOTP = async () => {
    setCanResend(false);
    setResendTimer(60);
    try {
      await authService.sendEmailOtp(email, { create: signingUp });
      Alert.alert('Sent', 'A new code is on its way to your email.');
    } catch (error) {
      Alert.alert('Error', 'Failed to resend the code. Please try again.');
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} className="flex-1">
      <View className="flex-1 bg-white px-6 justify-center">
        <View className="mb-12 items-center">
          <Text className="text-3xl font-bold text-green-600 mb-4">Verify your email</Text>
          <Text className="text-gray-600 text-center">
            We&apos;ve sent a 6-digit code to {'\n'}
            <Text className="font-semibold">{email}</Text>
          </Text>
        </View>

        <View className="mb-8">
          <TextInput
            className="border-2 border-green-600 rounded-lg px-4 py-4 text-2xl text-center font-bold tracking-widest"
            placeholder="000000"
            keyboardType="number-pad"
            value={otp}
            onChangeText={(text) => setOtp(text.replace(/\D/g, '').slice(0, 10))}
            maxLength={10}
            editable={!loading}
          />
        </View>

        <TouchableOpacity
          className={`${loading ? 'bg-green-400' : 'bg-green-600'} rounded-lg py-4 items-center mb-6`}
          onPress={handleVerifyOTP}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text className="text-white font-bold text-lg">Verify</Text>
          )}
        </TouchableOpacity>

        <View className="items-center">
          {canResend ? (
            <TouchableOpacity onPress={handleResendOTP}>
              <Text className="text-green-600 font-semibold">Resend code</Text>
            </TouchableOpacity>
          ) : (
            <Text className="text-gray-500">
              Resend code in <Text className="font-bold text-gray-700">{resendTimer}s</Text>
            </Text>
          )}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
