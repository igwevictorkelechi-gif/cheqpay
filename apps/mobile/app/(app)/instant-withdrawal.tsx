import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Switch, Alert, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { colors } from '@/components/brand';
import { api, getAccessToken } from '@/services/api';

export default function InstantWithdrawalScreen() {
  const insets = useSafeAreaInsets();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        if (!(await getAccessToken())) return;
        const me = await api.getMe();
        setEnabled(me.instantWithdrawal);
      } catch {
        setEnabled(false);
      }
    })();
  }, []);

  const toggle = async (next: boolean) => {
    const apply = async () => {
      setBusy(true);
      const prev = enabled;
      setEnabled(next);
      try {
        await api.setInstantWithdrawal(next);
      } catch {
        setEnabled(prev ?? false);
        Alert.alert('Could not update', 'Please try again.');
      } finally {
        setBusy(false);
      }
    };
    if (next) {
      Alert.alert(
        'Enable instant withdrawal?',
        'Crypto withdrawals will no longer require a 2FA code. This is faster but less secure.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Enable', style: 'destructive', onPress: apply },
        ]
      );
    } else {
      apply();
    }
  };

  return (
    <View className="flex-1" style={{ backgroundColor: colors.surface, paddingTop: insets.top + 8 }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}
      >
        <TouchableOpacity
          onPress={() => router.back()}
          className="w-11 h-11 rounded-full bg-card items-center justify-center"
        >
          <Ionicons name="arrow-back" size={22} color={colors.ink} />
        </TouchableOpacity>

        <View className="w-16 h-16 rounded-3xl items-center justify-center mt-6" style={{ backgroundColor: 'rgba(239,68,68,0.15)' }}>
          <Ionicons name="flash" size={30} color="#EF4444" />
        </View>

        <Text className="text-ink text-4xl font-extrabold mt-5 mb-2">Instant withdrawal</Text>
        <Text className="text-muted text-base mb-6">
          Skip the 2FA step when withdrawing crypto. Convenient, but it lowers your account security —
          only enable this if you understand the risk.
        </Text>

        {enabled === null ? (
          <View className="py-8 items-center">
            <ActivityIndicator color={colors.brand} />
          </View>
        ) : (
          <View className="flex-row items-center justify-between bg-card rounded-2xl p-4">
            <View className="flex-1 pr-3">
              <Text className="text-ink text-base font-semibold">Withdraw without 2FA</Text>
              <Text className="text-muted text-xs mt-0.5">
                {enabled ? 'Enabled — withdrawals skip 2FA' : 'Disabled — 2FA required'}
              </Text>
            </View>
            <Switch
              value={enabled}
              onValueChange={toggle}
              disabled={busy}
              trackColor={{ false: colors.circle, true: '#EF4444' }}
              thumbColor={colors.white}
            />
          </View>
        )}
      </ScrollView>
    </View>
  );
}
