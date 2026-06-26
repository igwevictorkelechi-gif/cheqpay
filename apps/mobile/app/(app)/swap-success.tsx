import { View, Text, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { colors } from '@/components/brand';

function CoinBadge({ symbol, size = 36 }: { symbol: string; size?: number }) {
  const map: Record<string, { bg: string; glyph: string }> = {
    BTC: { bg: '#F7931A', glyph: '₿' },
    ETH: { bg: '#627EEA', glyph: 'Ξ' },
    USDT: { bg: '#26A17B', glyph: '₮' },
  };
  const c = map[symbol] ?? { bg: colors.brand, glyph: symbol.charAt(0) };
  return (
    <View
      className="rounded-full items-center justify-center"
      style={{ width: size, height: size, backgroundColor: c.bg }}
    >
      <Text style={{ color: '#FFFFFF', fontSize: size * 0.45, fontWeight: '700' }}>{c.glyph}</Text>
    </View>
  );
}

export default function SwapSuccessScreen() {
  const insets = useSafeAreaInsets();
  const { from = '0.75', to = '22.85', fromSym = 'BTC', toSym = 'ETH' } =
    useLocalSearchParams<{ from: string; to: string; fromSym: string; toSym: string }>();

  return (
    <View
      className="flex-1 px-6"
      style={{ backgroundColor: colors.surface, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 16 }}
    >
      <View className="flex-1 items-center justify-center">
        {/* Success check */}
        <View
          className="w-24 h-24 rounded-full items-center justify-center"
          style={{ backgroundColor: 'rgba(52,199,89,0.15)' }}
        >
          <View
            className="w-16 h-16 rounded-full items-center justify-center"
            style={{ backgroundColor: colors.positive }}
          >
            <Ionicons name="checkmark" size={36} color="#FFFFFF" />
          </View>
        </View>

        <Text className="text-ink text-2xl font-extrabold mt-6">Swap Successful</Text>
        <Text className="text-muted text-sm mt-2 text-center">
          You swapped {from} {fromSym} for {to} {toSym}
        </Text>

        {/* Summary */}
        <View className="bg-card rounded-3xl p-5 mt-6 w-full">
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center" style={{ gap: 8 }}>
              <CoinBadge symbol={String(fromSym)} />
              <Text className="text-ink font-bold">
                {from} {fromSym}
              </Text>
            </View>
            <Ionicons name="arrow-forward" size={18} color={colors.muted} />
            <View className="flex-row items-center" style={{ gap: 8 }}>
              <CoinBadge symbol={String(toSym)} />
              <Text className="text-ink font-bold">
                {to} {toSym}
              </Text>
            </View>
          </View>
        </View>
      </View>

      {/* Actions */}
      <View>
        <TouchableOpacity
          onPress={() => router.replace('/(app)/transactions')}
          className="rounded-full py-4 items-center"
          style={{ backgroundColor: colors.brand }}
          activeOpacity={0.85}
        >
          <Text className="text-white text-base font-bold">View transaction history</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => router.replace('/(app)/crypto')}
          className="py-3 items-center mt-1"
        >
          <Text className="text-muted text-base font-semibold">Done</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
