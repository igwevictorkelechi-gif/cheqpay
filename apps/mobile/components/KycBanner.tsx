import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { api, getAccessToken } from '@/services/api';

/** Amber alert shown on the home screen when the user is not verified (tier < 2). */
export function KycBanner() {
  const [tier, setTier] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        if (!(await getAccessToken())) return;
        const { kycTier } = await api.getKyc();
        setTier(kycTier);
      } catch {
        /* ignore */
      }
    })();
  }, []);

  if (dismissed || tier === null || tier >= 2) return null;

  return (
    <View className="px-5 pb-1 pt-1">
      <TouchableOpacity
        onPress={() => router.push('/(app)/kyc')}
        activeOpacity={0.85}
        className="flex-row items-center rounded-2xl p-3.5"
        style={{ backgroundColor: 'rgba(245,166,35,0.1)', borderWidth: 1, borderColor: 'rgba(245,166,35,0.3)' }}
      >
        <View className="w-9 h-9 rounded-full items-center justify-center" style={{ backgroundColor: 'rgba(245,166,35,0.2)' }}>
          <Ionicons name="shield-half-outline" size={18} color="#F5A623" />
        </View>
        <View className="ml-3 flex-1">
          <Text className="text-sm font-bold" style={{ color: '#F5C97B' }}>
            Verify your identity
          </Text>
          <Text className="text-xs" style={{ color: 'rgba(245,201,123,0.8)' }}>
            Your account isn&apos;t verified. Verify to raise limits and unlock withdrawals.
          </Text>
        </View>
        <TouchableOpacity onPress={() => setDismissed(true)} hitSlop={10} className="ml-1">
          <Ionicons name="close" size={18} color="rgba(245,201,123,0.7)" />
        </TouchableOpacity>
      </TouchableOpacity>
    </View>
  );
}
