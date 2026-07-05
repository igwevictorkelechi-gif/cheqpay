import React from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { colors } from '@/components/brand';
import { useUIStore } from '@/store';

type Option = {
  key: 'dark' | 'light';
  title: string;
  subtitle: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
};

const options: Option[] = [
  { key: 'dark', title: 'Dark', subtitle: 'CheqPay classic — easy on the eyes', icon: 'moon' },
  { key: 'light', title: 'Light', subtitle: 'Bright and clean for daytime', icon: 'sunny' },
];

export default function AppThemeScreen() {
  const insets = useSafeAreaInsets();
  const { darkMode, setDarkMode } = useUIStore();
  const active: Option['key'] = darkMode ? 'dark' : 'light';

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

        <Text className="text-ink text-4xl font-extrabold mt-6">App Theme</Text>
        <Text className="text-muted text-sm mt-2 mb-4">
          Control CheqPay app&apos;s look and feel.
        </Text>

        <View style={{ gap: 14 }}>
          {options.map((o) => {
            const selected = active === o.key;
            return (
              <TouchableOpacity
                key={o.key}
                activeOpacity={0.8}
                onPress={() => setDarkMode(o.key === 'dark')}
                className="flex-row items-center bg-card rounded-3xl p-4"
                style={selected ? { borderWidth: 1.5, borderColor: colors.brand } : { borderWidth: 1.5, borderColor: 'transparent' }}
              >
                <View
                  className="w-12 h-12 rounded-2xl items-center justify-center"
                  style={{ backgroundColor: colors.circle }}
                >
                  <Ionicons name={o.icon} size={24} color={colors.ink} />
                </View>
                <View className="ml-4 flex-1">
                  <Text className="text-ink text-lg font-bold">{o.title}</Text>
                  <Text className="text-muted text-sm mt-0.5">{o.subtitle}</Text>
                </View>
                {selected ? (
                  <Ionicons name="checkmark-circle" size={26} color={colors.brand} />
                ) : (
                  <View
                    className="w-6 h-6 rounded-full"
                    style={{ borderWidth: 2, borderColor: colors.border }}
                  />
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}
