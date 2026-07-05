import { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Switch } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { colors } from '@/components/brand';

type Toggle = { key: string; title: string; subtitle: string; value: boolean };

const initial: Toggle[] = [
  { key: 'deposits', title: 'Deposits', subtitle: 'When money lands in your wallet', value: true },
  { key: 'withdrawals', title: 'Withdrawals', subtitle: 'Status updates on your payouts', value: true },
  { key: 'trades', title: 'Buy, sell & convert', subtitle: 'Confirmations for crypto trades', value: true },
  { key: 'bills', title: 'Bill payments', subtitle: 'Airtime, data, electricity & more', value: true },
  { key: 'price', title: 'Price alerts', subtitle: 'Big moves on BTC and USDT', value: false },
  { key: 'security', title: 'Security alerts', subtitle: 'New logins and sensitive changes', value: true },
  { key: 'promos', title: 'Product & promotions', subtitle: 'News, tips and special offers', value: false },
];

export default function NotificationsScreen() {
  const insets = useSafeAreaInsets();
  const [toggles, setToggles] = useState<Toggle[]>(initial);

  const flip = (key: string) =>
    setToggles((prev) => prev.map((t) => (t.key === key ? { ...t, value: !t.value } : t)));

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

        <Text className="text-ink text-4xl font-extrabold mt-6">Notifications</Text>
        <Text className="text-muted text-sm mt-2 mb-4">
          Choose what CheqPay lets you know about.
        </Text>

        <View className="bg-card rounded-3xl px-4">
          {toggles.map((t, i) => (
            <View
              key={t.key}
              className="flex-row items-center py-4"
              style={i > 0 ? { borderTopWidth: 1, borderTopColor: colors.border } : undefined}
            >
              <View className="flex-1 pr-3">
                <Text className="text-ink text-base font-semibold">{t.title}</Text>
                <Text className="text-muted text-xs mt-0.5">{t.subtitle}</Text>
              </View>
              <Switch
                value={t.value}
                onValueChange={() => flip(t.key)}
                trackColor={{ false: colors.circle, true: colors.brand }}
                thumbColor={colors.white}
              />
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}
