import React from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { colors } from '@/components/brand';

type Row = {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  iconColor: string;
  iconBg: string;
  title: string;
  subtitle: string;
  route: string;
  danger?: boolean;
};

const rows: Row[] = [
  {
    icon: 'person',
    iconColor: '#4FA8FF',
    iconBg: 'rgba(79,168,255,0.15)',
    title: 'Personal details',
    subtitle: 'Review and update your personal info',
    route: '/(app)/personal-details',
  },
  {
    icon: 'trending-up',
    iconColor: '#F5A623',
    iconBg: 'rgba(245,166,35,0.15)',
    title: 'Account limits',
    subtitle: 'Know your spending limits',
    route: '/(app)/account-limits',
  },
  {
    icon: 'document-text',
    iconColor: '#34C759',
    iconBg: 'rgba(52,199,89,0.15)',
    title: 'Wallet statement',
    subtitle: 'Your financial history readily available',
    route: '/(app)/wallet-statement',
  },
  {
    icon: 'trash',
    iconColor: '#EF4444',
    iconBg: 'rgba(239,68,68,0.15)',
    title: 'Permanently delete your account',
    subtitle: 'We’re sorry to see you go',
    route: '/(app)/delete-account',
    danger: true,
  },
];

export default function AccountScreen() {
  const insets = useSafeAreaInsets();

  return (
    <View className="flex-1" style={{ backgroundColor: colors.surface, paddingTop: insets.top + 8 }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32 }}
      >
        <TouchableOpacity
          onPress={() => router.back()}
          className="w-11 h-11 rounded-full bg-card items-center justify-center"
        >
          <Ionicons name="arrow-back" size={22} color={colors.ink} />
        </TouchableOpacity>

        <Text className="text-ink text-4xl font-extrabold mt-6 mb-2">Account information</Text>

        <View className="mt-4" style={{ gap: 16 }}>
          {rows.map((row) => (
            <TouchableOpacity
              key={row.title}
              onPress={() => router.push(row.route as never)}
              activeOpacity={0.8}
              className="flex-row items-center bg-card rounded-3xl p-4"
            >
              <View
                className="w-12 h-12 rounded-2xl items-center justify-center"
                style={{ backgroundColor: row.iconBg }}
              >
                <Ionicons name={row.icon} size={24} color={row.iconColor} />
              </View>
              <View className="ml-4 flex-1">
                <Text
                  className="text-lg font-bold"
                  style={{ color: row.danger ? '#EF4444' : colors.ink }}
                >
                  {row.title}
                </Text>
                <Text className="text-muted text-sm mt-0.5">{row.subtitle}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.muted} />
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}
