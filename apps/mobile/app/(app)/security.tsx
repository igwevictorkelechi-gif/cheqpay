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
};

const rows: Row[] = [
  {
    icon: 'shield-checkmark',
    iconColor: '#F5A623',
    iconBg: 'rgba(245,166,35,0.15)',
    title: '2-step authentication',
    subtitle: 'Extra protection to boost account security',
    route: '/(app)/two-factor',
  },
  {
    icon: 'key',
    iconColor: '#FF7A59',
    iconBg: 'rgba(255,122,89,0.15)',
    title: 'Change password',
    subtitle: 'Update your account password',
    route: '/(app)/change-password',
  },
  {
    icon: 'lock-closed',
    iconColor: '#8A7BB5',
    iconBg: 'rgba(138,123,181,0.2)',
    title: 'App lock',
    subtitle: 'Manage how you unlock your app',
    route: '/(app)/app-lock',
  },
  {
    icon: 'flash',
    iconColor: '#EF4444',
    iconBg: 'rgba(239,68,68,0.15)',
    title: 'Instant withdrawal',
    subtitle: 'Withdraw without 2FA verification',
    route: '/(app)/instant-withdrawal',
  },
];

export default function SecurityScreen() {
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

        <Text className="text-ink text-4xl font-extrabold mt-6 mb-2">Security</Text>

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
                <Text className="text-ink text-lg font-bold">{row.title}</Text>
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
