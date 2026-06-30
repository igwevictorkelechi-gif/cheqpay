import { useEffect, useState } from 'react';
import { View, Text, ScrollView, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useAuthStore, useUIStore } from '@/store';
import { api, ApiError, type LedgerTransaction } from '@/services/api';
import {
  colors,
  TopBar,
  BalanceBlock,
  ActionRow,
  CircleAction,
  Card,
  SectionHeader,
} from '@/components/brand';
import { TxnRow } from '@/components/TxnRow';

const META = [
  { symbol: 'BTC', name: 'Bitcoin', bg: '#F7931A', glyph: '₿' },
  { symbol: 'USDT', name: 'Tether', bg: '#26A17B', glyph: '₮' },
];
const CRYPTO_TYPES = new Set(['BUY', 'SELL', 'CONVERT']);

function CoinIcon({ bg, glyph }: { bg: string; glyph: string }) {
  return (
    <View className="w-11 h-11 rounded-full items-center justify-center" style={{ backgroundColor: bg }}>
      <Text style={{ color: '#FFFFFF', fontSize: 20, fontWeight: '700' }}>{glyph}</Text>
    </View>
  );
}

export default function CryptoScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const { showBalance, toggleBalance } = useUIStore();
  const [bal, setBal] = useState<Record<string, string>>({});
  const [ngn, setNgn] = useState<Record<string, number>>({});
  const [txns, setTxns] = useState<LedgerTransaction[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    try {
      const refresh = async () => {
        const [{ balances }, btc, usdt, txRes] = await Promise.all([
          api.getBalances(),
          api.getPrice('BTC').catch(() => null),
          api.getPrice('USDT').catch(() => null),
          api.getTransactions(20).catch(() => ({ transactions: [] as LedgerTransaction[] })),
        ]);
        const map: Record<string, string> = {};
        for (const b of balances) map[b.asset] = b.availableFormatted;
        const prices: Record<string, number> = {
          BTC: btc?.priceNgn ? Number(btc.priceNgn) : 0,
          USDT: usdt?.priceNgn ? Number(usdt.priceNgn) : 0,
        };
        setBal(map);
        setNgn({
          BTC: Number(map.BTC ?? 0) * prices.BTC,
          USDT: Number(map.USDT ?? 0) * prices.USDT,
        });
        setTxns(
          txRes.transactions.filter(
            (t) => CRYPTO_TYPES.has(t.type) || t.asset === 'BTC' || t.asset === 'USDT'
          )
        );
      };
      try {
        await refresh();
      } catch (e) {
        if (e instanceof ApiError && (e.status === 404 || e.status === 401)) {
          await api.ensureProvisioned();
          await refresh();
        }
      }
    } catch {
      /* keep last values */
    }
  }

  useEffect(() => {
    load();
  }, [user?.id]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const totalNgn = (ngn.BTC ?? 0) + (ngn.USDT ?? 0);
  const fmtNgn = (n: number) =>
    '₦' + n.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <View className="flex-1" style={{ backgroundColor: colors.surface, paddingTop: insets.top }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 24 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <TopBar
          name={user?.full_name}
          onAvatarPress={() => router.push('/(app)/profile')}
          icons={[
            { name: 'search-outline', onPress: () => router.push('/(app)/transactions') },
            { name: showBalance ? 'eye-outline' : 'eye-off-outline', onPress: toggleBalance },
            { name: 'notifications-outline' },
          ]}
        />

        <BalanceBlock label="Total Crypto Balance" amount={showBalance ? fmtNgn(totalNgn) : '₦••••'} />

        <ActionRow>
          <CircleAction icon="trending-up" label="Trade" onPress={() => router.push('/(app)/convert')} />
          <CircleAction icon="arrow-down" label="Receive" onPress={() => router.push('/(app)/receive')} />
          <CircleAction icon="arrow-forward" label="Send" onPress={() => router.push('/(app)/send-crypto')} />
        </ActionRow>

        {/* Assets */}
        <View className="px-5 mb-6">
          <Card>
            {META.map((asset, i) => (
              <View
                key={asset.symbol}
                className={`flex-row items-center justify-between ${i > 0 ? 'mt-5' : ''}`}
              >
                <View className="flex-row items-center">
                  <CoinIcon bg={asset.bg} glyph={asset.glyph} />
                  <View className="ml-3">
                    <Text className="text-ink text-lg font-bold">{asset.symbol}</Text>
                    <Text className="text-muted text-sm">{asset.name}</Text>
                  </View>
                </View>
                <View className="items-end">
                  <Text className="text-ink text-lg font-bold">
                    {showBalance ? `${bal[asset.symbol] ?? '0'} ${asset.symbol}` : '••••'}
                  </Text>
                  <Text className="text-muted text-sm">
                    {showBalance ? fmtNgn(ngn[asset.symbol] ?? 0) : '••••'}
                  </Text>
                </View>
              </View>
            ))}
          </Card>
        </View>

        {/* Transactions */}
        <View className="px-5">
          <SectionHeader title="Transactions" onPress={() => router.push('/(app)/transactions')} />
          {txns.length === 0 ? (
            <Card>
              <Text className="text-muted text-sm text-center py-2">
                Your crypto transactions will appear here.
              </Text>
            </Card>
          ) : (
            <Card>
              {txns.slice(0, 6).map((t, i) => (
                <TxnRow key={t.id} t={t} divider={i > 0} />
              ))}
            </Card>
          )}
        </View>
      </ScrollView>
    </View>
  );
}
