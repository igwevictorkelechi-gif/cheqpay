import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { colors } from '@/components/brand';
import { priceSheet, useFees } from '@/lib/fees';

/**
 * Every fee, read live from the same settings the server charges with — so
 * this screen is never out of date with what a user actually pays.
 */
export default function PricingScreen() {
  const insets = useSafeAreaInsets();
  const fees = useFees();

  return (
    <View className="flex-1" style={{ backgroundColor: colors.surface, paddingTop: insets.top + 8 }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32 }}
      >
        <TouchableOpacity
          onPress={() => router.back()}
          className="w-11 h-11 rounded-full bg-card dark:bg-card-dark items-center justify-center"
        >
          <Ionicons name="arrow-back" size={22} color={colors.ink} />
        </TouchableOpacity>

        <Text className="text-ink dark:text-ink-dark text-4xl font-extrabold mt-6">Pricing</Text>
        <Text className="text-muted dark:text-muted-dark text-sm mt-2">
          Every fee we charge, in one place. You also see the exact fee before you confirm anything.
        </Text>

        {fees === null ? (
          <ActivityIndicator color={colors.brand} style={{ marginTop: 32 }} />
        ) : (
          <View className="mt-6" style={{ gap: 20 }}>
            {priceSheet(fees).map((section) => (
              <View key={section.title}>
                <Text className="text-ink dark:text-ink-dark text-base font-bold mb-2">{section.title}</Text>
                <View className="bg-card dark:bg-card-dark rounded-3xl">
                  {section.rows.map((r, i) => (
                    <View
                      key={r.what}
                      className="flex-row items-start justify-between p-4"
                      style={{
                        gap: 12,
                        borderTopWidth: i === 0 ? 0 : 1,
                        borderTopColor: 'rgba(128,128,128,0.15)',
                      }}
                    >
                      <View className="flex-1">
                        <Text className="text-ink dark:text-ink-dark font-medium">{r.what}</Text>
                        {r.note ? (
                          <Text className="text-muted dark:text-muted-dark text-xs mt-0.5">{r.note}</Text>
                        ) : null}
                      </View>
                      <Text className="text-ink dark:text-ink-dark font-semibold text-right" style={{ maxWidth: '45%' }}>
                        {r.price}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            ))}
            <Text className="text-muted dark:text-muted-dark text-xs">
              Fees can change. When they do, this screen and every confirmation screen update at the same time,
              and a change never applies to a transaction you have already confirmed.
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}
