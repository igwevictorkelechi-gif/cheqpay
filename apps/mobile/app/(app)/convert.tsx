import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { colors } from '@/components/brand';

// Mock conversion rate (1 BTC ≈ 30.47 ETH) just for the preview UI.
const BTC_TO_ETH = 30.47;
const BTC_BALANCE = 0.9;
const ETH_BALANCE = 20;

function CoinBadge({ symbol }: { symbol: 'BTC' | 'ETH' }) {
  const bg = symbol === 'BTC' ? '#F7931A' : '#627EEA';
  const glyph = symbol === 'BTC' ? '₿' : 'Ξ';
  return (
    <View
      className="w-10 h-10 rounded-full items-center justify-center"
      style={{ backgroundColor: bg }}
    >
      <Text style={{ color: '#FFFFFF', fontSize: 18, fontWeight: '700' }}>{glyph}</Text>
    </View>
  );
}

function AssetCard({
  role,
  symbol,
  amount,
  balance,
  emphasize,
}: {
  role: string;
  symbol: 'BTC' | 'ETH';
  amount: string;
  balance: string;
  emphasize?: boolean;
}) {
  return (
    <View className="bg-card rounded-3xl p-5">
      <View className="flex-row items-center justify-between">
        <TouchableOpacity className="flex-row items-center" activeOpacity={0.7}>
          <CoinBadge symbol={symbol} />
          <Text className="text-ink text-lg font-bold ml-2">{symbol}</Text>
          <Ionicons name="chevron-down" size={16} color={colors.muted} style={{ marginLeft: 4 }} />
        </TouchableOpacity>
        <Text className="text-muted text-xs font-semibold" style={{ letterSpacing: 2 }}>
          {role}
        </Text>
      </View>
      <Text
        className="text-ink font-extrabold text-center mt-3"
        style={{ fontSize: emphasize ? 40 : 34 }}
      >
        {amount}
      </Text>
      <Text className="text-muted text-sm text-center mt-2">
        Balance: <Text className="text-ink font-semibold">{balance}</Text>
      </Text>
    </View>
  );
}

const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0', 'del'];

export default function ConvertScreen() {
  const insets = useSafeAreaInsets();
  const [source, setSource] = useState('0.75');

  const sourceNum = parseFloat(source || '0') || 0;
  const targetNum = sourceNum * BTC_TO_ETH;
  const target = targetNum.toLocaleString('en-US', {
    maximumFractionDigits: 2,
  });
  const targetRaw = targetNum.toFixed(2);

  const previewSwap = () => {
    router.push({
      pathname: '/(app)/swap-confirm',
      params: { from: source, to: targetRaw, fromSym: 'BTC', toSym: 'ETH' },
    });
  };

  const press = (key: string) => {
    setSource((prev) => {
      if (key === 'del') return prev.length <= 1 ? '0' : prev.slice(0, -1);
      const next = prev === '0' ? key : prev + key;
      return next.length > 12 ? prev : next;
    });
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
            Convert
          </Text>
        </View>

        {/* Swap cards */}
        <View className="px-5">
          <AssetCard role="SOURCE" symbol="BTC" amount={source} balance={`${BTC_BALANCE} BTC`} emphasize />

          <View className="items-center z-10" style={{ marginVertical: -16 }}>
            <TouchableOpacity
              className="w-12 h-12 rounded-full items-center justify-center"
              style={{ backgroundColor: colors.brand }}
              activeOpacity={0.8}
            >
              <Ionicons name="swap-vertical" size={20} color="#FFFFFF" />
            </TouchableOpacity>
          </View>

          <AssetCard role="TOKEN" symbol="ETH" amount={target} balance={`${ETH_BALANCE} ETH`} />
        </View>

        {/* Keypad */}
        <View className="flex-row flex-wrap px-5 mt-6" style={{ gap: 12 }}>
          {keys.map((key) => (
            <TouchableOpacity
              key={key}
              onPress={() => press(key)}
              className="bg-card rounded-2xl items-center justify-center"
              style={{ width: '31.5%', height: 56 }}
              activeOpacity={0.7}
            >
              {key === 'del' ? (
                <Ionicons name="backspace-outline" size={22} color={colors.ink} />
              ) : (
                <Text className="text-ink text-xl font-semibold">{key}</Text>
              )}
            </TouchableOpacity>
          ))}
        </View>

        {/* CTA */}
        <View className="px-5 mt-6">
          <TouchableOpacity
            className="rounded-full py-4 items-center"
            style={{ backgroundColor: colors.brand }}
            activeOpacity={0.85}
            onPress={previewSwap}
          >
            <Text className="text-white text-base font-bold">Preview Swap</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}
