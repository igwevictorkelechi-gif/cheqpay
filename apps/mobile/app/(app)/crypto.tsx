import { View, Text, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useAuthStore, useUIStore } from '@/store';
import {
  colors,
  TopBar,
  BalanceBlock,
  ActionRow,
  CircleAction,
  Card,
  SectionHeader,
} from '@/components/brand';

type Asset = {
  symbol: string;
  name: string;
  amount: string;
  fiat: string;
  bg: string;
  glyph: string;
  glyphColor: string;
};

const assets: Asset[] = [
  {
    symbol: 'BTC',
    name: 'Bitcoin',
    amount: '0 BTC',
    fiat: '0 NGN',
    bg: '#F7931A',
    glyph: '₿',
    glyphColor: '#FFFFFF',
  },
  {
    symbol: 'USDT',
    name: 'Tether',
    amount: '0 USDT',
    fiat: '0 NGN',
    bg: '#26A17B',
    glyph: '₮',
    glyphColor: '#FFFFFF',
  },
];

type CryptoTx = {
  title: string;
  date: string;
  amount: string;
  fiat: string;
  positive: boolean;
  bg: string;
  glyph: string;
};

const transactions: CryptoTx[] = [
  {
    title: 'Sold BTC',
    date: 'Jun 21, 2026',
    amount: '-0.00069782 BTC',
    fiat: '60,678.8 NGN',
    positive: false,
    bg: '#F7931A',
    glyph: '₿',
  },
  {
    title: 'Received BTC',
    date: 'Jun 21, 2026',
    amount: '0.00069782 BTC',
    fiat: '60,655.17 NGN',
    positive: true,
    bg: '#F7931A',
    glyph: '₿',
  },
  {
    title: 'Sold USDT',
    date: 'Jun 21, 2026',
    amount: '-2,000 USDT',
    fiat: '2,000 NGN',
    positive: false,
    bg: '#26A17B',
    glyph: '₮',
  },
];

function CoinIcon({ bg, glyph, color }: { bg: string; glyph: string; color: string }) {
  return (
    <View
      className="w-11 h-11 rounded-full items-center justify-center"
      style={{ backgroundColor: bg }}
    >
      <Text style={{ color, fontSize: 20, fontWeight: '700' }}>{glyph}</Text>
    </View>
  );
}

export default function CryptoScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const { showBalance, toggleBalance } = useUIStore();

  return (
    <View className="flex-1" style={{ backgroundColor: colors.surface, paddingTop: insets.top }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 24 }}
      >
        <TopBar
          name={user?.full_name}
          onAvatarPress={() => router.push('/(app)/profile')}
          icons={[
            { name: 'search-outline' },
            { name: showBalance ? 'eye-outline' : 'eye-off-outline', onPress: toggleBalance },
            { name: 'notifications-outline' },
          ]}
        />

        <BalanceBlock label="Total Crypto Balance" amount={showBalance ? '₦0.00' : '₦••••'} />

        <ActionRow>
          <CircleAction icon="trending-up" label="Trade" onPress={() => router.push('/(app)/convert')} />
          <CircleAction icon="arrow-down" label="Receive" />
          <CircleAction icon="arrow-forward" label="Send" />
        </ActionRow>

        {/* Assets */}
        <View className="px-5 mb-6">
          <Card>
            {assets.map((asset, i) => (
              <View
                key={asset.symbol}
                className={`flex-row items-center justify-between ${i > 0 ? 'mt-5' : ''}`}
              >
                <View className="flex-row items-center">
                  <CoinIcon bg={asset.bg} glyph={asset.glyph} color={asset.glyphColor} />
                  <View className="ml-3">
                    <Text className="text-ink text-lg font-bold">{asset.symbol}</Text>
                    <Text className="text-muted text-sm">{asset.name}</Text>
                  </View>
                </View>
                <View className="items-end">
                  <Text className="text-ink text-lg font-bold">
                    {showBalance ? asset.amount : '••••'}
                  </Text>
                  <Text className="text-muted text-sm">{asset.fiat}</Text>
                </View>
              </View>
            ))}
          </Card>
        </View>

        {/* Transactions */}
        <View className="px-5">
          <SectionHeader title="Transactions" onPress={() => router.push('/(app)/transactions')} />
          <Card>
            {transactions.map((tx, i) => (
              <View
                key={`${tx.title}-${i}`}
                className={`flex-row items-center justify-between ${i > 0 ? 'mt-5' : ''}`}
              >
                <View className="flex-row items-center flex-1">
                  <CoinIcon bg={tx.bg} glyph={tx.glyph} color="#FFFFFF" />
                  <View className="ml-3">
                    <Text className="text-ink text-base font-bold">{tx.title}</Text>
                    <Text className="text-muted text-sm">{tx.date}</Text>
                  </View>
                </View>
                <View className="items-end">
                  <Text
                    className="text-base font-bold"
                    style={{ color: tx.positive ? colors.positive : colors.ink }}
                  >
                    {tx.amount}
                  </Text>
                  <Text className="text-muted text-sm">{tx.fiat}</Text>
                </View>
              </View>
            ))}
          </Card>
        </View>
      </ScrollView>
    </View>
  );
}
