import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { colors } from '@/components/brand';

const RATE = 30.47;

function CoinBadge({ symbol, size = 44 }: { symbol: string; size?: number }) {
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

function Leg({ caption, amount, symbol }: { caption: string; amount: string; symbol: string }) {
  return (
    <View className="flex-row items-center justify-between">
      <View>
        <Text className="text-muted text-sm">{caption}</Text>
        <Text className="text-ink text-2xl font-extrabold mt-1">
          {amount} <Text className="text-lg">{symbol}</Text>
        </Text>
      </View>
      <CoinBadge symbol={symbol} />
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center justify-between py-2">
      <Text className="text-muted text-sm">{label}</Text>
      <Text className="text-ink text-sm font-semibold">{value}</Text>
    </View>
  );
}

export default function SwapConfirmScreen() {
  const insets = useSafeAreaInsets();
  const { from = '0.75', to = '22.85', fromSym = 'BTC', toSym = 'ETH' } =
    useLocalSearchParams<{ from: string; to: string; fromSym: string; toSym: string }>();
  const [processing, setProcessing] = useState(false);

  const confirm = () => {
    setProcessing(true);
    setTimeout(() => {
      router.replace({
        pathname: '/(app)/swap-success',
        params: { from, to, fromSym, toSym },
      });
    }, 1200);
  };

  return (
    <View className="flex-1" style={{ backgroundColor: colors.surface, paddingTop: insets.top }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
        {/* Header */}
        <View className="flex-row items-center px-5 pt-3 pb-2">
          <TouchableOpacity
            onPress={() => router.back()}
            className="w-10 h-10 rounded-full bg-card items-center justify-center"
          >
            <Ionicons name="chevron-back" size={22} color={colors.ink} />
          </TouchableOpacity>
          <Text className="flex-1 text-center text-ink text-lg font-bold" style={{ paddingRight: 40 }}>
            Confirm Swap
          </Text>
        </View>

        {/* Pay / receive */}
        <View className="px-5">
          <View className="bg-card rounded-3xl p-5">
            <Leg caption="You pay" amount={String(from)} symbol={String(fromSym)} />
            <View className="items-center my-4">
              <View
                className="w-9 h-9 rounded-full items-center justify-center"
                style={{ backgroundColor: colors.brand }}
              >
                <Ionicons name="arrow-down" size={16} color="#FFFFFF" />
              </View>
            </View>
            <Leg caption="You receive" amount={String(to)} symbol={String(toSym)} />
          </View>
        </View>

        {/* Details */}
        <View className="px-5 mt-4">
          <View className="bg-card rounded-3xl p-5">
            <Row label="Rate" value={`1 ${fromSym} = ${RATE} ${toSym}`} />
            <Row label="Network fee" value="≈ ₦250" />
            <Row label="Estimated time" value="~2 mins" />
            <View style={{ height: 1, backgroundColor: colors.border, marginVertical: 4 }} />
            <Row label="You receive" value={`${to} ${toSym}`} />
          </View>
        </View>

        {/* CTA */}
        <View className="px-5 mt-6">
          <TouchableOpacity
            onPress={confirm}
            disabled={processing}
            className="rounded-full py-4 items-center"
            style={{ backgroundColor: colors.brand, opacity: processing ? 0.6 : 1 }}
            activeOpacity={0.85}
          >
            <Text className="text-white text-base font-bold">
              {processing ? 'Swapping…' : 'Confirm Swap'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => router.back()}
            disabled={processing}
            className="py-3 items-center mt-1"
          >
            <Text className="text-muted text-base font-semibold">Cancel</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}
