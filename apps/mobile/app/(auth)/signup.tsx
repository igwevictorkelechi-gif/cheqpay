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
  ScrollView,
} from 'react-native';
import { Linking } from 'react-native';
import { router } from 'expo-router';
import { authService } from '@/services/auth';
import { Logo } from '@/components/brand';

const TERMS_URL = 'https://mycheqpay.com/terms';
const PRIVACY_URL = 'https://mycheqpay.com/privacy';

export default function SignupScreen() {
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSendOTP = async () => {
    if (!email || !email.includes('@')) {
      Alert.alert('Error', 'Please enter a valid email address');
      return;
    }
    if (!fullName || fullName.length < 2) {
      Alert.alert('Error', 'Please enter your full name');
      return;
    }
    if (!agreed) {
      Alert.alert(
        'One more thing',
        'Please agree to the Terms of Service and Privacy Policy to create your account.'
      );
      return;
    }

    setLoading(true);
    try {
      const result = await authService.sendEmailOtp(email.trim().toLowerCase(), {
        create: true,
        fullName: fullName.trim(),
        phone: phone.trim(),
      });
      if (result.success) {
        router.push({
          pathname: '/(auth)/verify-otp',
          params: { email: email.trim().toLowerCase(), fullName, isSignup: '1' },
        });
      } else {
        Alert.alert('Error', 'Could not send the code. Please try again.');
      }
    } catch (error) {
      Alert.alert('Error', 'An error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} className="flex-1">
      <ScrollView className="flex-1 bg-white px-6" contentContainerStyle={{ justifyContent: 'center' }}>
        {/* Header */}
        <View className="mb-8 items-center">
          <Logo width={180} />
          <Text className="text-2xl font-bold text-gray-900 mt-4 mb-1">Create Account</Text>
          <Text className="text-gray-500 text-center text-sm">
            Join CheqPay and start managing your finances
          </Text>
        </View>

        {/* Full Name Input */}
        <View className="mb-4">
          <Text className="text-gray-700 font-semibold mb-2">Full Name</Text>
          <TextInput
            className="border border-gray-300 rounded-lg px-4 py-3 text-base"
            placeholder="John Doe"
            value={fullName}
            onChangeText={setFullName}
            editable={!loading}
          />
        </View>

        {/* Email Input */}
        <View className="mb-4">
          <Text className="text-gray-700 font-semibold mb-2">Email Address</Text>
          <TextInput
            className="border border-gray-300 rounded-lg px-4 py-3 text-base"
            placeholder="john@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
            value={email}
            onChangeText={setEmail}
            editable={!loading}
          />
        </View>

        {/* Phone Input */}
        <View className="mb-6">
          <Text className="text-gray-700 font-semibold mb-2">Phone Number (optional)</Text>
          <TextInput
            className="border border-gray-300 rounded-lg px-4 py-3 text-base"
            placeholder="08012345678"
            keyboardType="phone-pad"
            value={phone}
            onChangeText={setPhone}
            editable={!loading}
          />
        </View>

        {/* Terms + Privacy consent */}
        <TouchableOpacity
          className="flex-row items-start mb-6"
          activeOpacity={0.7}
          onPress={() => setAgreed((v) => !v)}
          disabled={loading}
        >
          <View
            className={`w-5 h-5 rounded border items-center justify-center mt-0.5 ${
              agreed ? 'bg-green-600 border-green-600' : 'border-gray-400'
            }`}
          >
            {agreed && <Text className="text-white text-xs font-bold">✓</Text>}
          </View>
          <Text className="text-gray-600 text-sm ml-3 flex-1">
            I agree to CheqPay&apos;s{' '}
            <Text
              className="text-green-600 font-semibold"
              onPress={() => Linking.openURL(TERMS_URL).catch(() => undefined)}
            >
              Terms of Service
            </Text>{' '}
            and{' '}
            <Text
              className="text-green-600 font-semibold"
              onPress={() => Linking.openURL(PRIVACY_URL).catch(() => undefined)}
            >
              Privacy Policy
            </Text>
            , including the collection of my identity information for verification.
          </Text>
        </TouchableOpacity>

        {/* Create Account Button */}
        <TouchableOpacity
          className={`${
            loading || !agreed ? 'bg-green-400' : 'bg-green-600'
          } rounded-lg py-4 items-center mb-4`}
          onPress={handleSendOTP}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text className="text-white font-bold text-lg">Create Account</Text>
          )}
        </TouchableOpacity>

        {/* Login Link */}
        <View className="flex-row justify-center items-center">
          <Text className="text-gray-600">Already have an account? </Text>
          <TouchableOpacity onPress={() => router.push('/(auth)/login')}>
            <Text className="text-green-600 font-bold">Login</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
