import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import Constants from 'expo-constants';
import { colors } from '@/components/brand';

/**
 * "About CheqPay", reached from Profile → About us (the route keeps its old
 * name so existing links still land here). Mirrors the website's About page.
 *
 * This screen used to be a leftover Settings page with Notifications,
 * Biometric and Dark Mode switches; the first two changed nothing. The real
 * controls live in Security (biometrics, app lock) and Preferences
 * (notifications, theme).
 */

type Row = {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  subtitle: string;
  /** An in-app screen, or a page on the website. */
  to: string;
};

const SITE = 'https://mycheqpay.com';

const rows: Row[] = [
  { icon: 'business-outline', title: 'Our story', subtitle: 'Who we are and what we stand for', to: `${SITE}/about/company/` },
  { icon: 'help-circle-outline', title: 'FAQs', subtitle: 'Answers to common questions', to: `${SITE}/faq/` },
  { icon: 'chatbubbles-outline', title: 'Help & Support', subtitle: 'Get help with your account', to: '/(app)/support' },
  { icon: 'mail-outline', title: 'Contact us', subtitle: 'Reach our team', to: `${SITE}/contact/` },
  { icon: 'document-text-outline', title: 'Legal & policies', subtitle: 'Privacy, terms, AML and cookies', to: `${SITE}/legal/` },
];

export default function AboutScreen() {
  const insets = useSafeAreaInsets();
  const version = Constants.expoConfig?.version ?? '1.0.0';

  const open = (to: Row['to']) => {
    if (to.startsWith('https://')) Linking.openURL(to).catch(() => undefined);
    else router.push(to);
  };

  return (
    <View className="flex-1" style={{ backgroundColor: colors.surface, paddingTop: insets.top + 8 }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32 }}>
        <TouchableOpacity
          onPress={() => router.back()}
          className="w-11 h-11 rounded-full bg-card dark:bg-card-dark items-center justify-center"
          accessibilityLabel="Back"
        >
          <Ionicons name="arrow-back" size={22} color={colors.ink} />
        </TouchableOpacity>

        <Text className="text-ink dark:text-ink-dark text-4xl font-extrabold mt-6">About CheqPay</Text>
        <Text className="text-muted dark:text-muted-dark text-sm mt-2 mb-5">Everything you need to know about us.</Text>

        <View style={{ gap: 12 }}>
          {rows.map((r) => (
            <TouchableOpacity
              key={r.title}
              activeOpacity={0.8}
              onPress={() => open(r.to)}
              className="flex-row items-center bg-card dark:bg-card-dark rounded-3xl p-4"
            >
              <View className="w-11 h-11 rounded-2xl items-center justify-center" style={{ backgroundColor: colors.circle }}>
                <Ionicons name={r.icon} size={22} color={colors.ink} />
              </View>
              <View className="ml-4 flex-1">
                <Text className="text-ink dark:text-ink-dark text-base font-bold">{r.title}</Text>
                <Text className="text-muted dark:text-muted-dark text-sm mt-0.5">{r.subtitle}</Text>
              </View>
              <Ionicons
                name={r.to.startsWith('https://') ? 'open-outline' : 'chevron-forward'}
                size={18}
                color={colors.muted}
              />
            </TouchableOpacity>
          ))}
        </View>

        <Text className="text-muted dark:text-muted-dark text-xs text-center mt-8">
          CheqPay v{version} · © {new Date().getFullYear()} CheqPay. All rights reserved.
        </Text>
      </ScrollView>
    </View>
  );
}
