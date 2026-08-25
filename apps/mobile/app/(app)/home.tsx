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
import PromoPopup from '@/components/PromoPopup';
import { useFeatures } from '@/lib/useFeatures';

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const { showBalance, toggleBalance } = useUIStore();
  const features = useFeatures();
  const [ngn, setNgn] = useState(0);
  const [usd, setUsd] = useState(0);
  const [currency, setCurrency] = useState<'NGN' | 'USD'>('NGN');
  // Kept per currency so switching tabs is instant and never shows the other
  // currency's history.
  const [ngnTxns, setNgnTxns] = useState<LedgerTransaction[]>([]);
  const [usdTxns, setUsdTxns] = useState<LedgerTransaction[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    try {
      const refresh = async () => {
        const [{ balances }, ngnRes, usdRes] = await Promise.all([
          api.getBalances(),
          api.getTransactions(6, 'NGN'),
          api.getTransactions(6, 'USD'),
        ]);
        const cash = Number(balances.find((b) => b.asset === 'NGN')?.availableFormatted ?? 0);
        const dollars = Number(balances.find((b) => b.asset === 'USD')?.availableFormatted ?? 0);
        setNgn(cash);
        setUsd(dollars);
        setNgnTxns(ngnRes.transactions);
        setUsdTxns(usdRes.transactions);
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

  const isUsd = currency === 'USD';
  const value = isUsd ? usd : ngn;
  const symbol = isUsd ? '$' : '₦';
  const locale = isUsd ? 'en-US' : 'en-NG';
  // Everything below the tab reads from the selected currency only.
  const txns = isUsd ? usdTxns : ngnTxns;
  const formattedBalance = showBalance
    ? symbol +
      value.toLocaleString(locale, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    : `${symbol}••••`;

  /**
   * USD payouts are not live yet. Point the user at the conversion that does
   * work rather than leaving a dead button.
   */
  const onWithdraw = () => {
    if (isUsd) {
      router.push('/(app)/convert');
      return;
    }
    router.push('/(app)/withdraw');
  };

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

        {/* Currency tab — switch the balance block between naira and dollars. */}
        <View className="items-center mt-4">
          <View className="flex-row rounded-full p-1" style={{ backgroundColor: colors.card }}>
            {(['NGN', 'USD'] as const).map((c) => {
              const active = currency === c;
              return (
                <TouchableOpacity
                  key={c}
                  onPress={() => setCurrency(c)}
                  className="flex-row items-center rounded-full px-5 py-2"
                  style={{ backgroundColor: active ? colors.brand : 'transparent', gap: 6 }}
                >
                  <Text>{c === 'NGN' ? '🇳🇬' : '🇺🇸'}</Text>
                  <Text style={{ color: active ? '#fff' : colors.muted, fontWeight: '700', fontSize: 13 }}>
                    {c}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <BalanceBlock label={isUsd ? 'USD Balance' : 'Total Cash Balance'} amount={formattedBalance} />

        <KycBanner />

        {features.ngn_deposits && value === 0 && txns.length === 0 && (
          <View className="px-5 mb-6">
            <TouchableOpacity
              activeOpacity={0.9}
              onPress={() =>
                router.push(
                  isUsd ? { pathname: '/(app)/deposit', params: { currency: 'USD' } } : '/(app)/deposit',
                )
              }
              className="flex-row items-center rounded-3xl p-5"
              style={{ backgroundColor: colors.brand }}
            >
              <View className="w-12 h-12 rounded-2xl items-center justify-center" style={{ backgroundColor: 'rgba(255,255,255,0.2)' }}>
                <Ionicons name="arrow-down" size={24} color="#FFFFFF" />
              </View>
              <View className="flex-1 ml-4">
                <Text className="text-white font-bold text-base">
                  {isUsd ? 'Add dollars to get started' : 'Add money to get started'}
                </Text>
                <Text className="text-white/80 text-sm mt-0.5">
                  {isUsd
                    ? 'Open your USD account to receive dollars from anywhere.'
                    : 'Fund your wallet by bank transfer to buy crypto and pay bills.'}
                </Text>
              </View>
            </TouchableOpacity>
          </View>
        )}

        <ActionRow>
          {features.ngn_deposits && (
            <CircleAction
              icon="arrow-down"
              label="Deposit"
              onPress={() =>
                router.push(
                  isUsd ? { pathname: '/(app)/deposit', params: { currency: 'USD' } } : '/(app)/deposit',
                )
              }
            />
          )}
          {features.ngn_withdrawals && (
            <CircleAction icon="arrow-forward" label="Withdraw" onPress={onWithdraw} />
          )}
          {features.crypto_trading && (
            <CircleAction icon="sync" label="Convert" onPress={() => router.push('/(app)/convert')} />
          )}
          {features.p2p_transfers && (
            <CircleAction icon="paper-plane" label="Send" onPress={() => router.push('/(app)/send-user')} />
          )}
        </ActionRow>

        {/* Cash account — the selected currency only. */}
        <View className="px-5 mb-4">
          <Card>
            <Text className="text-muted dark:text-muted-dark text-base font-medium mb-4">Cash</Text>
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center">
                {isUsd ? (
                  <View
                    className="rounded-full items-center justify-center"
                    style={{ width: 40, height: 40, backgroundColor: 'rgba(34,197,94,0.15)' }}
                  >
                    <Text style={{ color: '#22C55E', fontSize: 18, fontWeight: '700' }}>$</Text>
                  </View>
                ) : (
                  <NairaFlag />
                )}
                <View className="ml-3">
                  <Text className="text-ink dark:text-ink-dark text-lg font-bold">{currency}</Text>
                  <Text className="text-muted dark:text-muted-dark text-sm">
                    {isUsd ? 'US Dollar' : 'Naira'}
                  </Text>
                </View>
              </View>
              <Text className="text-ink dark:text-ink-dark text-lg font-bold">
                {showBalance
                  ? `${value.toLocaleString(locale, { maximumFractionDigits: 2 })} ${currency}`
                  : `•••• ${currency}`}
              </Text>
            </View>
          </Card>
        </View>

        {/* Transactions */}
        <View className="px-5">
          <SectionHeader
            title="Transactions"
            onPress={() =>
              router.push(
                isUsd
                  ? { pathname: '/(app)/transactions', params: { currency: 'USD' } }
                  : '/(app)/transactions',
              )
            }
          />
          {txns.length === 0 ? (
            <Card>
              <Text className="text-muted dark:text-muted-dark text-sm text-center py-2">
                {isUsd ? 'No dollar transactions yet.' : 'No Naira transactions yet.'}
              </Text>
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
      <PromoPopup />
    </View>
  );
}
