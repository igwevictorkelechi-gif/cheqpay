import { useEffect } from 'react';
import { Tabs } from 'expo-router';
import { registerForPushNotifications } from '@/services/push';
import TabBar from '@/components/TabBar';

export default function AppLayout() {
  useEffect(() => {
    registerForPushNotifications();
  }, []);

  return (
    <Tabs
      // Floating glass tab bar. It owns which tabs are visible, their icons
      // and their feature gating — see components/TabBar.tsx. The per-screen
      // `href`/`tabBarIcon` options below would be ignored, so the four tab
      // screens are registered here without them.
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen name="home" />
      <Tabs.Screen name="crypto" />
      <Tabs.Screen name="pay-bill" />
      <Tabs.Screen name="cards" />

      {/* Secondary screens — reachable via navigation but hidden from the tab bar */}
      <Tabs.Screen name="deposit" options={{ href: null }} />
      <Tabs.Screen name="convert" options={{ href: null }} />
      <Tabs.Screen name="swap-confirm" options={{ href: null }} />
      <Tabs.Screen name="swap-success" options={{ href: null }} />
      <Tabs.Screen name="send-money" options={{ href: null }} />
      <Tabs.Screen name="send-user" options={{ href: null }} />
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
      <Tabs.Screen name="statement" options={{ href: null }} />
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
    </Tabs>
  );
}
