import { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useAuthStore } from '@/store';

export default function KYCScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const [bvn, setBvn] = useState('');
  const [nin, setNin] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmitKYC = async () => {
    if (!bvn && !nin) {
      Alert.alert('Error', 'Please enter either BVN or NIN');
      return;
    }

    setLoading(true);
    try {
      // Call KYC submission endpoint
      Alert.alert('Success', 'KYC information submitted. You will be verified shortly.');
    } catch (error) {
      Alert.alert('Error', 'Failed to submit KYC information');
    } finally {
      setLoading(false);
    }
  };

  const isVerified = user?.kyc_status === 'approved';

  return (
    <ScrollView className="flex-1 bg-white" contentContainerStyle={{ paddingTop: insets.top }}>
      {/* Header */}
      <View className="px-6 py-4 flex-row items-center border-b border-gray-100">
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={28} color="#1F2937" />
        </TouchableOpacity>
        <Text className="text-gray-800 text-2xl font-bold ml-4">KYC Verification</Text>
      </View>

      <View className="px-6 py-8">
        {/* Status Card */}
        <View className={`rounded-lg p-6 mb-8 ${
          isVerified ? 'bg-green-50' : 'bg-amber-50'
        }`}>
          <View className="flex-row items-center">
            <Ionicons
              name={isVerified ? 'checkmark-circle' : 'time'}
              size={32}
              color={isVerified ? '#10B981' : '#F59E0B'}
            />
            <View className="ml-4 flex-1">
              <Text className={`font-bold text-lg ${
                isVerified ? 'text-green-900' : 'text-amber-900'
              }`}>
                {isVerified ? 'Verified' : 'Verification Pending'}
              </Text>
              <Text className={`text-sm ${
                isVerified ? 'text-green-700' : 'text-amber-700'
              }`}>
                {isVerified
                  ? 'Your account is fully verified'
                  : 'Complete verification to unlock all features'}
              </Text>
            </View>
          </View>
        </View>

        {!isVerified && (
          <>
            {/* Information */}
            <View className="bg-blue-50 rounded-lg p-4 mb-8">
              <Text className="text-blue-900 font-semibold mb-2">Verify Your Identity</Text>
              <Text className="text-blue-800 text-sm">
                Provide your BVN or NIN for verification. This helps us comply with regulations and keep your account secure.
              </Text>
            </View>

            {/* BVN Input */}
            <View className="mb-6">
              <Text className="text-gray-700 font-semibold mb-3">BVN (Bank Verification Number)</Text>
              <TextInput
                className="border border-gray-300 rounded-lg px-4 py-3 text-base"
                placeholder="11-digit BVN"
                keyboardType="number-pad"
                value={bvn}
                onChangeText={setBvn}
                maxLength={11}
                editable={!loading}
              />
            </View>

            {/* OR */}
            <View className="items-center mb-6">
              <Text className="text-gray-500 font-semibold">OR</Text>
            </View>

            {/* NIN Input */}
            <View className="mb-8">
              <Text className="text-gray-700 font-semibold mb-3">NIN (National Identification Number)</Text>
              <TextInput
                className="border border-gray-300 rounded-lg px-4 py-3 text-base"
                placeholder="11-digit NIN"
                keyboardType="number-pad"
                value={nin}
                onChangeText={setNin}
                maxLength={11}
                editable={!loading}
              />
            </View>

            {/* Submit Button */}
            <TouchableOpacity
              className={`${
                loading ? 'bg-green-400' : 'bg-green-600'
              } rounded-lg py-4 items-center`}
              onPress={handleSubmitKYC}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text className="text-white font-bold text-lg">Submit for Verification</Text>
              )}
            </TouchableOpacity>
          </>
        )}
      </View>
    </ScrollView>
  );
}
