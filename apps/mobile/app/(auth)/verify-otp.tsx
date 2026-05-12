import React, { useState, useEffect } from 'react';
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

export default function VerifyOTPScreen() {
  const route = useRoute();
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [resendTimer, setResendTimer] = useState(60);
  const [canResend, setCanResend] = useState(false);

  const { phone, email, fullName, isSignup } = route.params as {
    phone: string;
    email?: string;
    fullName?: string;
    isSignup: boolean;
  };

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
    if (!otp || otp.length !== 6) {
      Alert.alert('Error', 'Please enter a 6-digit OTP');
      return;
    }

    setLoading(true);
    try {
      let result;

      if (isSignup) {
        // Register new user
        result = await authService.register(phone, email!, fullName!, otp);
        if (result.success && result.data?.user) {
          setUser(result.data.user);
          setIsAuthenticated(true);
          router.replace('/(app)/home');
        }
      } else {
        // Login existing user
        result = await authService.verifyOTP(phone, otp);
        if (result.success) {
          const user = await authService.getCurrentUser();
          if (user) {
            setUser(user);
            setIsAuthenticated(true);
            router.replace('/(app)/home');
          }
        }
      }

      if (!result.success) {
        Alert.alert('Error', 'Invalid OTP. Please try again.');
      }
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
      await authService.sendOTP(phone);
      Alert.alert('Success', 'OTP sent again to your phone number');
    } catch (error) {
      Alert.alert('Error', 'Failed to resend OTP. Please try again.');
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} className="flex-1">
      <View className="flex-1 bg-white px-6 justify-center">
        {/* Header */}
        <View className="mb-12 items-center">
          <Text className="text-3xl font-bold text-green-600 mb-4">Verify OTP</Text>
          <Text className="text-gray-600 text-center">
            We've sent a 6-digit code to {'\n'}
            <Text className="font-semibold">{phone}</Text>
          </Text>
        </View>

        {/* OTP Input */}
        <View className="mb-8">
          <TextInput
            className="border-2 border-green-600 rounded-lg px-4 py-4 text-2xl text-center font-bold tracking-widest"
            placeholder="000000"
            keyboardType="number-pad"
            value={otp}
            onChangeText={(text) => setOtp(text.slice(0, 6))}
            maxLength={6}
            editable={!loading}
          />
        </View>

        {/* Verify Button */}
        <TouchableOpacity
          className={`${
            loading ? 'bg-green-400' : 'bg-green-600'
          } rounded-lg py-4 items-center mb-6`}
          onPress={handleVerifyOTP}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text className="text-white font-bold text-lg">Verify OTP</Text>
          )}
        </TouchableOpacity>

        {/* Resend Link */}
        <View className="items-center">
          {canResend ? (
            <TouchableOpacity onPress={handleResendOTP}>
              <Text className="text-green-600 font-semibold">Resend OTP</Text>
            </TouchableOpacity>
          ) : (
            <Text className="text-gray-500">
              Resend OTP in <Text className="font-bold text-gray-700">{resendTimer}s</Text>
            </Text>
          )}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
