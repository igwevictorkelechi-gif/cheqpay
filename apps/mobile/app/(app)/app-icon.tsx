import { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import {
  setAlternateAppIcon,
  getAppIconName,
  supportsAlternateIcons,
} from 'expo-alternate-app-icons';
import { colors } from '@/components/brand';

// `iconName` maps to the alternate icon declared in app.json (null = default).
type IconOption = { key: string; iconName: string | null; label: string; bg: string; fg: string };

const iconOptions: IconOption[] = [
  { key: 'default', iconName: null, label: 'Default', bg: colors.brand, fg: '#FFFFFF' },
  { key: 'midnight', iconName: 'Midnight', label: 'Midnight', bg: '#14121A', fg: colors.brandLight },
  { key: 'mint', iconName: 'Mint', label: 'Mint', bg: '#34C759', fg: '#0B2A16' },
  { key: 'gold', iconName: 'Gold', label: 'Gold', bg: '#F5A623', fg: '#3A2600' },
];

function currentKey(): string {
  try {
    const name = getAppIconName();
    return iconOptions.find((o) => o.iconName === name)?.key ?? 'default';
  } catch {
    return 'default';
  }
}

export default function AppIconScreen() {
  const insets = useSafeAreaInsets();
  const [selected, setSelected] = useState(currentKey);

  const choose = async (opt: IconOption) => {
    if (opt.key === selected) return;
    if (!supportsAlternateIcons) {
      Alert.alert(
        'Not available',
        'Changing the app icon needs the full CheqPay build. It isn’t supported in Expo Go.'
      );
      return;
    }
    const prev = selected;
    setSelected(opt.key); // optimistic
    try {
      await setAlternateAppIcon(opt.iconName);
    } catch {
      setSelected(prev);
      Alert.alert('Could not change icon', 'Please try again.');
    }
  };

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
                onPress={() => choose(o)}
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
          Your selection is applied to your home screen.
        </Text>
      </ScrollView>
    </View>
  );
}
