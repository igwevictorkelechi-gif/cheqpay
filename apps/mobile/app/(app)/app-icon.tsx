import { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { colors } from '@/components/brand';

type IconOption = { key: string; label: string; bg: string; fg: string };

const iconOptions: IconOption[] = [
  { key: 'default', label: 'Default', bg: colors.brand, fg: '#FFFFFF' },
  { key: 'midnight', label: 'Midnight', bg: '#14121A', fg: colors.brandLight },
  { key: 'mint', label: 'Mint', bg: '#34C759', fg: '#0B2A16' },
  { key: 'gold', label: 'Gold', bg: '#F5A623', fg: '#3A2600' },
];

export default function AppIconScreen() {
  const insets = useSafeAreaInsets();
  const [selected, setSelected] = useState('default');

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

        <Text className="text-ink text-4xl font-extrabold mt-6">App Icon</Text>
        <Text className="text-muted text-sm mt-2 mb-5">
          Change the CheqPay app icon to match your style.
        </Text>

        <View className="flex-row flex-wrap" style={{ gap: 16 }}>
          {iconOptions.map((o) => {
            const isSel = selected === o.key;
            return (
              <TouchableOpacity
                key={o.key}
                activeOpacity={0.85}
                onPress={() => setSelected(o.key)}
                className="items-center bg-card rounded-3xl p-4"
                style={{
                  width: '47%',
                  borderWidth: 1.5,
                  borderColor: isSel ? colors.brand : 'transparent',
                }}
              >
                <View
                  className="w-20 h-20 rounded-3xl items-center justify-center"
                  style={{ backgroundColor: o.bg }}
                >
                  <Text className="text-3xl font-extrabold" style={{ color: o.fg }}>
                    C
                  </Text>
                </View>
                <View className="flex-row items-center mt-3">
                  <Text className="text-ink text-base font-semibold">{o.label}</Text>
                  {isSel && (
                    <Ionicons name="checkmark-circle" size={18} color={colors.brand} style={{ marginLeft: 6 }} />
                  )}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text className="text-muted text-xs text-center mt-6">
          Your selection is applied across the app.
        </Text>
      </ScrollView>
    </View>
  );
}
