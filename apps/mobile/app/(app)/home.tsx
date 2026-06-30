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
  NairaFlag,
  SectionHeader,
} from '@/components/brand';
import { TxnRow } from '@/components/TxnRow';

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const { showBalance, toggleBalance } = useUIStore();
  const [ngn, setNgn] = useState(0);
  const [txns, setTxns] = useState<LedgerTransaction[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    try {
      const refresh = async () => {
        const [{ balances }, { transactions }] = await Promise.all([
          api.getBalances(),
          api.getTransactions(6),
        ]);
        const cash = Number(balances.find((b) => b.asset === 'NGN')?.availableFormatted ?? 0);
        setNgn(cash);
        setTxns(transactions);
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

  const formattedBalance = showBalance
    ? '₦' + ngn.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '₦••••';

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

        <BalanceBlock label="Total Cash Balance" amount={formattedBalance} />

        <ActionRow>
          <CircleAction icon="arrow-down" label="Deposit" onPress={() => router.push('/(app)/deposit')} />
          <CircleAction icon="arrow-forward" label="Withdraw" onPress={() => router.push('/(app)/withdraw')} />
          <CircleAction icon="sync" label="Convert" onPress={() => router.push('/(app)/convert')} />
        </ActionRow>

        {/* Cash account */}
        <View className="px-5 mb-4">
          <Card>
            <Text className="text-muted text-base font-medium mb-4">Cash</Text>
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center">
                <NairaFlag />
                <View className="ml-3">
                  <Text className="text-ink text-lg font-bold">NGN</Text>
                  <Text className="text-muted text-sm">Naira</Text>
                </View>
              </View>
              <Text className="text-ink text-lg font-bold">
                {showBalance
                  ? `${ngn.toLocaleString('en-NG', { maximumFractionDigits: 2 })} NGN`
                  : '•••• NGN'}
              </Text>
            </View>
          </Card>
        </View>

        {/* Transactions */}
        <View className="px-5">
          <SectionHeader title="Transactions" onPress={() => router.push('/(app)/transactions')} />
          {txns.length === 0 ? (
            <Card>
              <Text className="text-muted text-sm text-center py-2">No transactions yet.</Text>
            </Card>
          ) : (
            <Card>
              {txns.slice(0, 5).map((t, i) => (
                <TxnRow key={t.id} t={t} divider={i > 0} />
              ))}
            </Card>
          )}
        </View>
      </ScrollView>
    </View>
  );
}
