import React, { useState } from 'react';
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
import { router } from 'expo-router';
import { useAuthStore, useWalletStore } from '@/store';
import { authService } from '@/services/auth';
import { demoUser, demoWallet, demoVirtualAccount } from '@/lib/demo';

export default function LoginScreen() {
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const { setUser, setIsAuthenticated } = useAuthStore();
  const { setWallet, setVirtualAccount } = useWalletStore();

  const continueAsDemo = () => {
    setUser(demoUser);
    setIsAuthenticated(true);
    setWallet(demoWallet);
    setVirtualAccount(demoVirtualAccount);
    router.replace('/(app)/home');
  };

  const handleSendOTP = async () => {
    if (!phone || phone.length < 10) {
      Alert.alert('Error', 'Please enter a valid phone number');
      return;
    }

    setLoading(true);
    try {
      const result = await authService.sendOTP(phone);
      if (result.success) {
        // Navigate to OTP verification screen
        router.push({
          pathname: '/(auth)/verify-otp',
          params: { phone, isSignup: false },
        });
      } else {
        Alert.alert('Error', 'Failed to send OTP. Please try again.');
      }
    } catch (error) {
      Alert.alert('Error', 'An error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} className="flex-1">
      <View className="flex-1 bg-white px-6 justify-center">
        {/* Logo/Header */}
        <View className="mb-12 items-center">
          <Text className="text-4xl font-bold text-green-600 mb-2">CheqPay</Text>
          <Text className="text-gray-500 text-center text-base">
            Fast, secure money transfer and wallet management
          </Text>
        </View>

        {/* Phone Input */}
        <View className="mb-6">
          <Text className="text-gray-700 font-semibold mb-3">Phone Number</Text>
          <TextInput
            className="border border-gray-300 rounded-lg px-4 py-3 text-base"
            placeholder="08012345678"
            keyboardType="phone-pad"
            value={phone}
            onChangeText={setPhone}
            editable={!loading}
          />
          <Text className="text-gray-500 text-xs mt-2">
            We'll send an OTP to verify your number
          </Text>
        </View>

        {/* Send OTP Button */}
        <TouchableOpacity
          className={`${
            loading ? 'bg-green-400' : 'bg-green-600'
          } rounded-lg py-4 items-center mb-6`}
          onPress={handleSendOTP}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text className="text-white font-bold text-lg">Send OTP</Text>
          )}
        </TouchableOpacity>

        {/* Demo button */}
        <TouchableOpacity
          className="border border-gray-300 rounded-lg py-4 items-center mb-6"
          onPress={continueAsDemo}
          disabled={loading}
        >
          <Text className="text-gray-800 font-bold text-lg">Continue as demo user</Text>
        </TouchableOpacity>

        {/* Sign Up Link */}
        <View className="flex-row justify-center items-center">
          <Text className="text-gray-600">Don't have an account? </Text>
          <TouchableOpacity onPress={() => router.push('/(auth)/signup')}>
            <Text className="text-green-600 font-bold">Sign Up</Text>
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
