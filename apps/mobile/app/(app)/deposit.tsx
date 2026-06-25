import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { colors, NairaFlag } from '@/components/brand';

export default function AddMoneyScreen() {
  const insets = useSafeAreaInsets();
  const [amount, setAmount] = useState('1000');

  const digits = amount.replace(/\D/g, '');
  const display = digits ? Number(digits).toLocaleString('en-NG') : '0';
  const valid = Number(digits) > 0;

  return (
    <View
      className="flex-1 px-5"
      style={{ backgroundColor: colors.surface, paddingTop: insets.top + 8, paddingBottom: 12 }}
    >
      {/* Header */}
      <TouchableOpacity
        onPress={() => router.back()}
        className="w-11 h-11 rounded-full bg-card items-center justify-center"
      >
        <Ionicons name="arrow-back" size={22} color={colors.ink} />
      </TouchableOpacity>

      <View className="flex-row items-center justify-between mt-5">
        <Text className="text-ink text-4xl font-extrabold">Add money</Text>
        <NairaFlag size={48} />
      </View>

      {/* Amount */}
      <View className="bg-card rounded-3xl p-5 mt-6">
        <View className="flex-row items-center justify-between">
          <View className="flex-1">
            <Text className="text-muted text-sm">Enter amount</Text>
            <TextInput
              value={display}
              onChangeText={(t) => setAmount(t.replace(/\D/g, ''))}
              keyboardType="number-pad"
              className="text-ink text-4xl font-extrabold mt-1"
              style={{ padding: 0 }}
              placeholderTextColor={colors.muted}
            />
          </View>
          <View className="flex-row items-center" style={{ gap: 8 }}>
            <NairaFlag size={28} />
            <Text className="text-ink text-xl font-bold">NGN</Text>
          </View>
        </View>
      </View>
      <Text className="text-muted text-sm mt-3">Available: 0 NGN</Text>

      {/* Pay with */}
      <Text className="text-ink text-base font-bold mt-8">Pay with</Text>
      <View className="flex-row items-center bg-card rounded-3xl p-5 mt-3" style={{ gap: 16 }}>
        <View className="w-14 h-14 rounded-full items-center justify-center" style={{ backgroundColor: colors.circle }}>
          <Ionicons name="business-outline" size={24} color={colors.ink} />
        </View>
        <View className="flex-1">
          <Text className="text-ink text-lg font-bold">Bank Transfer</Text>
          <Text className="text-muted text-sm mt-0.5">150 NGN Fees. Usually arrives in seconds</Text>
        </View>
      </View>

      {/* CTA */}
      <View className="flex-1 justify-end">
        <TouchableOpacity
          disabled={!valid}
          onPress={() => router.push({ pathname: '/(app)/deposit-transfer', params: { amount: digits } })}
          className="rounded-full py-4 items-center"
          style={{ backgroundColor: colors.brand, opacity: valid ? 1 : 0.5 }}
          activeOpacity={0.85}
        >
          <Text className="text-white text-base font-bold">Continue</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
