import { useState } from 'react';
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
import { authService } from '@/services/auth';
import { Logo } from '@/components/brand';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSendOTP = async () => {
    if (!email || !email.includes('@')) {
      Alert.alert('Error', 'Please enter a valid email address');
      return;
    }

    setLoading(true);
    try {
      const result = await authService.sendEmailOtp(email.trim().toLowerCase(), { create: false });
      if (result.success) {
        router.push({
          pathname: '/(auth)/verify-otp',
          params: { email: email.trim().toLowerCase(), isSignup: '' },
        });
      } else {
        Alert.alert('Error', 'Could not send the code. Check the email and try again.');
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
          <Logo width={230} />
          <Text className="text-gray-500 text-center text-base mt-3">
            Fast, secure money transfer and wallet management
          </Text>
        </View>

        {/* Email Input */}
        <View className="mb-6">
          <Text className="text-gray-700 font-semibold mb-3">Email Address</Text>
          <TextInput
            className="border border-gray-300 rounded-lg px-4 py-3 text-base"
            placeholder="you@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
            value={email}
            onChangeText={setEmail}
            editable={!loading}
          />
          <Text className="text-gray-500 text-xs mt-2">
            We'll email you a 6-digit code to sign in
          </Text>
        </View>

        {/* Send Code Button */}
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
            <Text className="text-white font-bold text-lg">Send code</Text>
          )}
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
