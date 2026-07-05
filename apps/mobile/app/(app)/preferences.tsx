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
  route?: string;
};

const rows: Row[] = [
  {
    icon: 'notifications',
    iconColor: '#F5A623',
    iconBg: 'rgba(245,166,35,0.15)',
    title: 'Notifications',
    subtitle: 'Customize your notification experience',
    route: '/(app)/settings',
  },
  {
    icon: 'color-palette',
    iconColor: '#4FA8FF',
    iconBg: 'rgba(79,168,255,0.15)',
    title: 'App Theme',
    subtitle: "Control CheqPay app's look and feel",
    route: '/(app)/settings',
  },
  {
    icon: 'cash',
    iconColor: '#34C759',
    iconBg: 'rgba(52,199,89,0.15)',
    title: 'Display Currency',
    subtitle: 'Nigerian Naira',
  },
  {
    icon: 'apps',
    iconColor: colors.brandLight,
    iconBg: 'rgba(138,123,181,0.2)',
    title: 'App Icon',
    subtitle: 'Change CheqPay app icon to your style',
  },
];

export default function PreferencesScreen() {
  const insets = useSafeAreaInsets();

  return (
    <View className="flex-1" style={{ backgroundColor: colors.surface, paddingTop: insets.top + 8 }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32 }}
      >
        {/* Back */}
        <TouchableOpacity
          onPress={() => router.back()}
          className="w-11 h-11 rounded-full bg-card items-center justify-center"
        >
          <Ionicons name="arrow-back" size={22} color={colors.ink} />
        </TouchableOpacity>

        <Text className="text-ink text-4xl font-extrabold mt-6 mb-2">Preferences</Text>

        <View className="mt-4" style={{ gap: 16 }}>
          {rows.map((row) => (
            <TouchableOpacity
              key={row.title}
              onPress={() => row.route && router.push(row.route as never)}
              activeOpacity={row.route ? 0.7 : 1}
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
              {row.route && <Ionicons name="chevron-forward" size={20} color={colors.muted} />}
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}
