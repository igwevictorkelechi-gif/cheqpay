import { useEffect, useState } from 'react';
import { View, Text, ScrollView, RefreshControl, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
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
import { KycBanner } from '@/components/KycBanner';

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
            { name: 'notifications-outline', onPress: () => router.push('/(app)/activity') },
          ]}
        />

        <BalanceBlock label="Total Cash Balance" amount={formattedBalance} />

        <KycBanner />

        {ngn === 0 && txns.length === 0 && (
          <View className="px-5 mb-6">
            <TouchableOpacity
              activeOpacity={0.9}
              onPress={() => router.push('/(app)/deposit')}
              className="flex-row items-center rounded-3xl p-5"
              style={{ backgroundColor: colors.brand }}
            >
              <View className="w-12 h-12 rounded-2xl items-center justify-center" style={{ backgroundColor: 'rgba(255,255,255,0.2)' }}>
                <Ionicons name="arrow-down" size={24} color="#FFFFFF" />
              </View>
              <View className="flex-1 ml-4">
                <Text className="text-white font-bold text-base">Add money to get started</Text>
                <Text className="text-white/80 text-sm mt-0.5">
                  Fund your wallet by bank transfer to buy crypto and pay bills.
                </Text>
              </View>
            </TouchableOpacity>
          </View>
        )}

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
                <TxnRow
                  key={t.id}
                  t={t}
                  divider={i > 0}
                  onPress={() => router.push(`/(app)/transaction/${t.id}`)}
                />
              ))}
            </Card>
          )}
        </View>
      </ScrollView>
    </View>
  );
}
