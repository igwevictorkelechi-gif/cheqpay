import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { colors, Avatar } from '@/components/brand';
import { useAuthStore } from '@/store';
import { authService } from '@/services/auth';
import { api, getAccessToken } from '@/services/api';
import { tierInfo } from '@/lib/tier';

type Item = { title: string; subtitle: string; route?: string };

const items: Item[] = [
  {
    title: 'Account',
    subtitle: 'Personal details, invite friends, account limits, statements, delete account',
    route: '/(app)/settings',
  },
  { title: 'Recipients', subtitle: 'Bank accounts, Mobile money', route: '/(app)/send-money' },
  { title: 'Connected bank accounts', subtitle: 'Manage your payment accounts', route: '/(app)/settings' },
  { title: 'Security', subtitle: '2FA, app lock, passcode, biometrics, instant withdrawal', route: '/(app)/settings' },
  { title: 'Preferences', subtitle: 'Notifications, display currency & app themes', route: '/(app)/preferences' },
  { title: 'About us', subtitle: 'FAQs, privacy policy, our blog, contact us', route: '/(app)/settings' },
];

function FeatureCard({
  icon,
  title,
  subtitle,
  cardBg,
  iconBg,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  subtitle: string;
  cardBg: string;
  iconBg: string;
}) {
  return (
    <View className="flex-1 rounded-3xl p-4 justify-between" style={{ minHeight: 130, backgroundColor: cardBg }}>
      <View className="w-9 h-9 rounded-full items-center justify-center" style={{ backgroundColor: iconBg }}>
        <Ionicons name={icon} size={18} color="#FFFFFF" />
      </View>
      <View>
        <Text className="text-ink text-base font-bold">{title}</Text>
        <Text className="text-muted text-xs mt-0.5">{subtitle}</Text>
      </View>
    </View>
  );
}

type Limits = {
  singleTxKobo: string;
  dailyDepositKobo: string;
  dailyWithdrawalKobo: string;
  cryptoWithdrawalEnabled: boolean;
};

function fmtNgn(kobo: string): string {
  return '₦' + (Number(kobo) / 100).toLocaleString('en-NG', { maximumFractionDigits: 0 });
}

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuthStore();
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

  const name = user?.full_name || 'CheqPay User';
  const handle =
    '@' + (user?.email?.split('@')[0] || name.split(' ')[0].toLowerCase() || 'cheqpay');

  const handleLogout = () => {
    Alert.alert('Log out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log out',
        style: 'destructive',
        onPress: async () => {
          try {
            await authService.logout();
          } catch {
            // ignore — still clear local state
          }
          logout();
          router.replace('/(auth)/login');
        },
      },
    ]);
  };

  return (
    <View className="flex-1" style={{ backgroundColor: colors.surface, paddingTop: insets.top + 8 }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32 }}>
        {/* Close */}
        <TouchableOpacity
          onPress={() => router.back()}
          className="w-11 h-11 rounded-full bg-card items-center justify-center"
        >
          <Ionicons name="close" size={22} color={colors.ink} />
        </TouchableOpacity>

        {/* Identity */}
        <View className="items-center mt-3">
          <View style={{ transform: [{ scale: 1.5 }], marginVertical: 12 }}>
            <Avatar name={name} />
          </View>
          <Text className="text-ink text-2xl font-extrabold mt-4">{name}</Text>
          <View className="bg-card rounded-full px-3 py-1 mt-2">
            <Text className="text-muted text-sm font-medium">{handle}</Text>
          </View>
        </View>

        {/* Account level (KYC tier) */}
        {tier !== null && (
          <TouchableOpacity
            onPress={() => router.push('/(app)/kyc')}
            activeOpacity={0.85}
            className="flex-row items-center bg-card rounded-2xl p-4 mt-6"
          >
            <View
              className="w-11 h-11 rounded-full items-center justify-center"
              style={{ backgroundColor: tierInfo(tier).verified ? 'rgba(52,199,89,0.15)' : 'rgba(245,166,35,0.15)' }}
            >
              <Ionicons
                name={tierInfo(tier).verified ? 'shield-checkmark' : 'shield-half'}
                size={22}
                color={tierInfo(tier).verified ? colors.positive : '#F5A623'}
              />
            </View>
            <View className="ml-3 flex-1">
              <Text className="text-ink text-base font-bold">{tierInfo(tier).label}</Text>
              <Text className="text-muted text-xs mt-0.5">{tierInfo(tier).description}</Text>
            </View>
            {!tierInfo(tier).verified && (
              <View className="rounded-full px-3 py-1.5" style={{ backgroundColor: colors.brand }}>
                <Text className="text-white text-xs font-bold">Verify</Text>
              </View>
            )}
          </TouchableOpacity>
        )}

        {/* Account limits */}
        {limits && (
          <View className="bg-card rounded-2xl p-4 mt-3">
            <Text className="text-muted text-xs font-semibold uppercase mb-3" style={{ letterSpacing: 0.5 }}>
              Your limits
            </Text>
            <View style={{ gap: 10 }}>
              <View className="flex-row items-center justify-between">
                <Text className="text-muted text-sm">Per transaction</Text>
                <Text className="text-ink text-sm font-semibold">{fmtNgn(limits.singleTxKobo)}</Text>
              </View>
              <View className="flex-row items-center justify-between">
                <Text className="text-muted text-sm">Daily deposit</Text>
                <Text className="text-ink text-sm font-semibold">{fmtNgn(limits.dailyDepositKobo)}</Text>
              </View>
              <View className="flex-row items-center justify-between">
                <Text className="text-muted text-sm">Daily withdrawal</Text>
                <Text className="text-ink text-sm font-semibold">{fmtNgn(limits.dailyWithdrawalKobo)}</Text>
              </View>
              <View className="flex-row items-center justify-between">
                <Text className="text-muted text-sm">Crypto withdrawals</Text>
                <Text
                  className="text-sm font-semibold"
                  style={{ color: limits.cryptoWithdrawalEnabled ? colors.positive : '#F5A623' }}
                >
                  {limits.cryptoWithdrawalEnabled ? 'Enabled' : 'Locked'}
                </Text>
              </View>
            </View>
            {!limits.cryptoWithdrawalEnabled && (
              <Text className="text-muted text-xs mt-3">
                Verify your identity to raise limits and unlock crypto withdrawals.
              </Text>
            )}
          </View>
        )}

        {/* Feature cards */}
        <View className="flex-row mt-6" style={{ gap: 16 }}>
          <FeatureCard
            icon="people"
            title="Join CheqPay Tribe"
            subtitle="For exclusive updates"
            cardBg="#3A3055"
            iconBg={colors.brand}
          />
          <FeatureCard
            icon="chatbubbles"
            title="Need help?"
            subtitle="Chat with us"
            cardBg="#161320"
            iconBg={colors.circle}
          />
        </View>

        {/* Menu */}
        <View className="mt-6" style={{ gap: 12 }}>
          {items.map((item) => (
            <TouchableOpacity
              key={item.title}
              onPress={() => item.route && router.push(item.route as never)}
              className="flex-row items-center bg-card rounded-2xl p-4"
              activeOpacity={0.7}
            >
              <View className="flex-1">
                <Text className="text-ink text-base font-bold">{item.title}</Text>
                <Text className="text-muted text-sm mt-0.5">{item.subtitle}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.muted} />
            </TouchableOpacity>
          ))}

          {/* Log out */}
          <TouchableOpacity
            onPress={handleLogout}
            className="flex-row items-center justify-between bg-card rounded-2xl p-4"
            activeOpacity={0.7}
          >
            <Text className="text-base font-bold" style={{ color: '#EF4444' }}>
              Log out
            </Text>
            <Ionicons name="chevron-forward" size={20} color="#EF4444" />
          </TouchableOpacity>
        </View>

        <Text className="text-muted text-xs text-center mt-6">App v1.0.0 (1)</Text>
      </ScrollView>
    </View>
  );
}
