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
  SectionHeader,
  ListCard,
} from '@/components/brand';
import { TxnRow } from '@/components/TxnRow';
import { KycBanner } from '@/components/KycBanner';
import PromoPopup from '@/components/PromoPopup';
import HomeBannerCarousel, { useHomeBanners } from '@/components/HomeBanner';
import { useFeatures } from '@/lib/useFeatures';
import NearbyStrip from '@/components/NearbyStrip';
import NextUpCard from '@/components/NextUpCard';

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const { showBalance, toggleBalance } = useUIStore();
  const features = useFeatures();
  const banners = useHomeBanners();
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
            ...(features.p2p_transfers
              ? [{ name: 'scan-outline' as const, onPress: () => router.push('/(app)/scan') }]
              : []),
            { name: 'search-outline', onPress: () => router.push('/(app)/transactions') },
            { name: showBalance ? 'eye-outline' : 'eye-off-outline', onPress: toggleBalance },
            { name: 'notifications-outline', onPress: () => router.push('/(app)/activity') },
          ]}
        />

        {/* Currency tab — switch the balance block between naira and dollars.
            Ink chips, not brand purple: v2 keeps purple for one accent a screen. */}
        <View className="items-center mt-4">
          <View className="flex-row rounded-full p-1" style={{ backgroundColor: colors.card, gap: 4 }}>
            {(['NGN', 'USD'] as const).map((c) => {
              const active = currency === c;
              return (
                <TouchableOpacity
                  key={c}
                  onPress={() => setCurrency(c)}
                  className="flex-row items-center rounded-full px-4"
                  style={{ height: 36, backgroundColor: active ? colors.ink : 'transparent', gap: 6 }}
                >
                  <Text>{c === 'NGN' ? '🇳🇬' : '🇺🇸'}</Text>
                  <Text style={{ color: active ? colors.surface : colors.muted, fontWeight: '600', fontSize: 13 }}>
                    {c}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <BalanceBlock label={isUsd ? 'Dollar balance' : 'Total balance'} amount={formattedBalance} />

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
                    : 'Top up by bank transfer, then save, send and pay bills from one place.'}
                </Text>
              </View>
            </TouchableOpacity>
          </View>
        )}

        {/* v2 quick actions: Add · Pay · Save · Convert. Pay is the one place to
            send money — to a bank account, a CheqPay user or a biller. */}
        <ActionRow>
          {features.ngn_deposits && (
            <CircleAction
              icon="arrow-down"
              label="Add"
              onPress={() =>
                router.push(
                  isUsd ? { pathname: '/(app)/deposit', params: { currency: 'USD' } } : '/(app)/deposit',
                )
              }
            />
          )}
          {(features.ngn_withdrawals || features.p2p_transfers || features.bill_payments) && (
            <CircleAction
              icon="paper-plane-outline"
              label="Pay"
              onPress={isUsd ? onWithdraw : () => router.push('/(app)/send')}
            />
          )}
          {features.ajo && <CircleAction icon="people-outline" label="Save" onPress={() => router.push('/(app)/ajo')} />}
          {features.crypto_trading && (
            <CircleAction icon="sync" label="Convert" onPress={() => router.push('/(app)/convert')} />
          )}
        </ActionRow>

        {!isUsd && <NextUpCard />}

        {/* Recent activity */}
        <View className="px-5 mb-6">
          <SectionHeader
            title="Recent activity"
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
                {isUsd ? 'No dollar transactions yet.' : 'No naira transactions yet.'}
              </Text>
            </Card>
          ) : (
            <ListCard>
              {txns.slice(0, 5).map((t, i) => (
                <TxnRow key={t.id} t={t} divider={i > 0} onPress={() => router.push(`/(app)/transaction/${t.id}`)} />
              ))}
            </ListCard>
          )}
        </View>

        {banners.length > 0 && (
          <View className="px-5 mb-6">
            <HomeBannerCarousel banners={banners} />
          </View>
        )}

        <NearbyStrip />
      </ScrollView>
      <PromoPopup />
    </View>
  );
}
