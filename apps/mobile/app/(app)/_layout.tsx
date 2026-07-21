import { useEffect } from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/components/brand';
import { registerForPushNotifications } from '@/services/push';
import { useFeatures } from '@/lib/useFeatures';

export default function AppLayout() {
  const features = useFeatures();
  const cryptoVisible =
    features.crypto_trading || features.crypto_deposits || features.crypto_withdrawals;
  useEffect(() => {
    registerForPushNotifications();
  }, []);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.ink,
        tabBarInactiveTintColor: '#6E6880',
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
        tabBarStyle: {
          borderTopColor: colors.border,
          backgroundColor: colors.card,
          height: 88,
          paddingTop: 8,
        },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'home' : 'home-outline'} size={24} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="crypto"
        options={{
          // Hidden entirely when every crypto feature is switched off.
          href: cryptoVisible ? '/crypto' : null,
          title: 'Crypto',
          tabBarIcon: ({ color }) => <Ionicons name="logo-bitcoin" size={24} color={color} />,
        }}
      />
      <Tabs.Screen
        name="pay-bill"
        options={{
          href: features.bill_payments ? '/pay-bill' : null,
          title: 'Pay Bill',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'pricetag' : 'pricetag-outline'} size={24} color={color} />
          ),
        }}
      />

      {/* Secondary screens — reachable via navigation but hidden from the tab bar */}
      <Tabs.Screen name="deposit" options={{ href: null }} />
      <Tabs.Screen name="convert" options={{ href: null }} />
      <Tabs.Screen name="swap-confirm" options={{ href: null }} />
      <Tabs.Screen name="swap-success" options={{ href: null }} />
      <Tabs.Screen name="send-money" options={{ href: null }} />
      <Tabs.Screen name="transactions" options={{ href: null }} />
      <Tabs.Screen name="profile" options={{ href: null }} />
      <Tabs.Screen name="airtime" options={{ href: null }} />
      <Tabs.Screen name="withdraw" options={{ href: null }} />
      <Tabs.Screen name="settings" options={{ href: null }} />
      <Tabs.Screen name="preferences" options={{ href: null }} />
      <Tabs.Screen name="notifications" options={{ href: null }} />
      <Tabs.Screen name="app-theme" options={{ href: null }} />
      <Tabs.Screen name="app-icon" options={{ href: null }} />
      <Tabs.Screen name="account" options={{ href: null }} />
      <Tabs.Screen name="personal-details" options={{ href: null }} />
      <Tabs.Screen name="account-limits" options={{ href: null }} />
      <Tabs.Screen name="wallet-statement" options={{ href: null }} />
      <Tabs.Screen name="delete-account" options={{ href: null }} />
      <Tabs.Screen name="security" options={{ href: null }} />
      <Tabs.Screen name="two-factor" options={{ href: null }} />
      <Tabs.Screen name="change-password" options={{ href: null }} />
      <Tabs.Screen name="app-lock" options={{ href: null }} />
      <Tabs.Screen name="instant-withdrawal" options={{ href: null }} />
      <Tabs.Screen name="transaction/[id]" options={{ href: null }} />
      <Tabs.Screen name="onboarding" options={{ href: null }} />
      <Tabs.Screen name="kyc" options={{ href: null }} />
      <Tabs.Screen name="bill/[service]" options={{ href: null }} />
      <Tabs.Screen name="receive" options={{ href: null }} />
      <Tabs.Screen name="send-crypto" options={{ href: null }} />
      <Tabs.Screen name="virtual-account" options={{ href: null }} />
      <Tabs.Screen name="support" options={{ href: null }} />
      <Tabs.Screen name="support-chat" options={{ href: null }} />
      <Tabs.Screen name="activity" options={{ href: null }} />
      <Tabs.Screen name="bank-accounts" options={{ href: null }} />
      <Tabs.Screen name="cards" options={{ href: null }} />
    </Tabs>
  );
}
