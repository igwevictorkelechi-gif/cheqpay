import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { colors } from '@/components/brand';

export default function DepositDoneScreen() {
  const insets = useSafeAreaInsets();

  return (
    <View
      className="flex-1 px-5"
      style={{ backgroundColor: colors.surface, paddingTop: insets.top + 8, paddingBottom: insets.bottom + 12 }}
    >
      {/* Success */}
      <View className="flex-1 items-center justify-center">
        <View
          className="w-28 h-28 rounded-full items-center justify-center"
          style={{ backgroundColor: 'rgba(52,199,89,0.15)' }}
        >
          <View
            className="w-20 h-20 rounded-full items-center justify-center"
            style={{ backgroundColor: colors.positive }}
          >
            <Ionicons name="checkmark" size={44} color="#FFFFFF" />
          </View>
        </View>
        <Text className="text-ink text-3xl font-extrabold mt-7">All done</Text>
        <Text className="text-muted text-base mt-3 text-center" style={{ maxWidth: 300 }}>
          The funds from your transfer will be deposited into your account shortly
        </Text>
      </View>

      {/* Recommended */}
      <TouchableOpacity
        onPress={() => router.replace('/(app)/home')}
        className="flex-row items-center bg-card rounded-3xl p-5"
        style={{ gap: 16 }}
        activeOpacity={0.85}
      >
        <View className="w-12 h-12 rounded-full items-center justify-center" style={{ backgroundColor: colors.circle }}>
          <Text style={{ fontSize: 22 }}>📈</Text>
        </View>
        <View className="flex-1">
          <Text className="text-muted text-xs font-semibold uppercase">Recommended</Text>
          <Text className="text-ink text-lg font-bold mt-1">Earn up to 20% interest p.a.</Text>
          <Text className="text-muted text-sm mt-0.5">
            Create a NGN or USD savings plan and watch your money grow
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.muted} />
      </TouchableOpacity>

      {/* CTA */}
      <TouchableOpacity
        onPress={() => router.replace('/(app)/home')}
        className="rounded-full py-4 items-center mt-4"
        style={{ backgroundColor: colors.brand }}
        activeOpacity={0.85}
      >
        <Text className="text-white text-base font-bold">Done</Text>
      </TouchableOpacity>
    </View>
  );
}
