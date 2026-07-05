import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { colors } from '@/components/brand';
import { api, getAccessToken } from '@/services/api';

type Limits = {
  singleTxKobo: string;
  dailyDepositKobo: string;
  dailyWithdrawalKobo: string;
  cryptoWithdrawalEnabled: boolean;
};

const fmtNgn = (kobo: string) =>
  '₦' + (Number(kobo) / 100).toLocaleString('en-NG', { maximumFractionDigits: 0 });

function LimitCard({
  label,
  value,
  icon,
  sub,
}: {
  label: string;
  value: string;
  icon: 'arrow-up' | 'arrow-down';
  sub?: string;
}) {
  return (
    <View className="bg-card rounded-3xl p-5">
      <View className="flex-row items-start justify-between">
        <View className="flex-1">
          <Text className="text-muted text-base">{label}</Text>
          <Text className="text-ink text-xl font-bold mt-1">{value}</Text>
        </View>
        <Ionicons name={icon} size={24} color={colors.ink} />
      </View>
      {!!sub && (
        <>
          <View className="h-1.5 rounded-full mt-4" style={{ backgroundColor: colors.circle }}>
            <View className="h-1.5 rounded-full" style={{ width: '100%', backgroundColor: colors.brand }} />
          </View>
          <Text className="text-muted text-sm mt-2">{sub}</Text>
        </>
      )}
    </View>
  );
}

export default function AccountLimitsScreen() {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<'crypto' | 'cash'>('crypto');
  const [tier, setTier] = useState<number | null>(null);
  const [limits, setLimits] = useState<Limits | null>(null);

  useEffect(() => {
    (async () => {
      try {
        if (!(await getAccessToken())) return;
        const { kycTier, limits } = await api.getKyc();
        setTier(kycTier);
        setLimits(limits);
      } catch {
        /* ignore */
      }
    })();
  }, []);

  const verified = (tier ?? 0) >= 2;

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

        <Text className="text-ink text-4xl font-extrabold mt-6">Account limits</Text>
        <View className="flex-row items-center mt-3 mb-5">
          <Text className="text-muted text-lg">Your account is currently </Text>
          <View
            className="rounded-full px-3 py-1"
            style={{ backgroundColor: verified ? colors.brand : colors.circle }}
          >
            <Text className="text-white text-sm font-bold">{verified ? 'Verified' : 'Unverified'}</Text>
          </View>
        </View>

        {/* Tabs */}
        <View className="flex-row bg-card rounded-2xl p-1 mb-6">
          {(['crypto', 'cash'] as const).map((t) => (
            <TouchableOpacity
              key={t}
              onPress={() => setTab(t)}
              className="flex-1 rounded-xl py-3 items-center"
              style={{ backgroundColor: tab === t ? colors.surface : 'transparent' }}
            >
              <Text className="text-base font-bold" style={{ color: tab === t ? colors.ink : colors.muted }}>
                {t === 'crypto' ? 'Crypto' : 'Cash'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {!limits ? (
          <View className="py-12 items-center">
            <ActivityIndicator color={colors.brand} />
          </View>
        ) : tab === 'crypto' ? (
          <View style={{ gap: 16 }}>
            <LimitCard
              label="Send"
              value={limits.cryptoWithdrawalEnabled ? 'Unlimited' : 'Locked'}
              icon="arrow-up"
            />
            <LimitCard label="Receive" value="Unlimited" icon="arrow-down" />
          </View>
        ) : (
          <View style={{ gap: 16 }}>
            <LimitCard
              label="Withdraw"
              value={`${fmtNgn(limits.dailyWithdrawalKobo)} per day`}
              icon="arrow-up"
              sub={`${fmtNgn(limits.dailyWithdrawalKobo)} available today`}
            />
            <LimitCard
              label="Deposit"
              value={`${fmtNgn(limits.dailyDepositKobo)} per day`}
              icon="arrow-down"
            />
          </View>
        )}

        {!verified && (
          <View className="mt-8">
            <Text className="text-muted text-center text-base leading-6">
              Unlock higher transaction limits effortlessly! Verify your identity today and enjoy
              expanded account limits.
            </Text>
            <TouchableOpacity
              onPress={() => router.push('/(app)/kyc')}
              className="rounded-full py-4 items-center mt-6"
              style={{ backgroundColor: colors.brand }}
            >
              <Text className="text-white text-base font-bold">Verify your identity</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </View>
  );
}
