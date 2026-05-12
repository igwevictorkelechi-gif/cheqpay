import React from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useWalletStore } from '@/store';

export default function FundWalletScreen() {
  const insets = useSafeAreaInsets();
  const { virtualAccount } = useWalletStore();

  return (
    <ScrollView className="flex-1 bg-white" contentContainerStyle={{ paddingTop: insets.top }}>
      {/* Header */}
      <View className="px-6 py-4 flex-row items-center">
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={28} color="#1F2937" />
        </TouchableOpacity>
        <Text className="text-gray-800 text-2xl font-bold ml-4">Fund Wallet</Text>
      </View>

      {/* Virtual Account Display */}
      <View className="px-6 py-8">
        <View className="bg-green-50 rounded-2xl p-6 mb-6">
          <Text className="text-gray-600 text-sm font-semibold mb-4">Bank Transfer to Your Account</Text>

          <View className="bg-white rounded-xl p-4 mb-4">
            <Text className="text-gray-500 text-xs mb-2">Account Number</Text>
            <Text className="text-gray-800 text-2xl font-bold">{virtualAccount?.account_number || 'Loading...'}</Text>
          </View>

          <View className="bg-white rounded-xl p-4 mb-4">
            <Text className="text-gray-500 text-xs mb-2">Bank Name</Text>
            <Text className="text-gray-800 text-lg font-semibold">{virtualAccount?.bank_name || 'Loading...'}</Text>
          </View>

          <TouchableOpacity className="bg-green-600 rounded-lg py-3 items-center mt-4">
            <Text className="text-white font-bold">Copy Account Number</Text>
          </TouchableOpacity>
        </View>

        {/* Instructions */}
        <View className="bg-blue-50 rounded-2xl p-6">
          <Text className="text-blue-900 font-bold text-lg mb-4">How to Fund Your Wallet</Text>
          <Text className="text-blue-800 mb-3">1. Transfer any amount to the account above from any Nigerian bank</Text>
          <Text className="text-blue-800 mb-3">2. Your wallet will be updated instantly after the transfer is confirmed</Text>
          <Text className="text-blue-800">3. No hidden charges. Enjoy free wallet funding!</Text>
        </View>
      </View>
    </ScrollView>
  );
}
