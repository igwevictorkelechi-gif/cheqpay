import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useAuthStore, useWalletStore, useUIStore } from '@/store';
import { walletService } from '@/services/wallet';
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

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const { wallet, setWallet, setVirtualAccount } = useWalletStore();
  const { showBalance, toggleBalance } = useUIStore();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadWalletData();
  }, [user?.id]);

  const loadWalletData = async () => {
    if (!user?.id) return;
    try {
      setLoading(true);
      const walletData = await walletService.getWallet(user.id);
      const vaData = await walletService.getVirtualAccount(user.id);
      if (walletData) setWallet(walletData);
      if (vaData) setVirtualAccount(vaData);
    } catch (error) {
      console.error('Error loading wallet:', error);
      Alert.alert('Error', 'Failed to load wallet data');
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadWalletData();
    setRefreshing(false);
  };

  const balance = wallet?.balance ?? 0;
  const formattedBalance = showBalance
    ? '₦' + balance.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '₦••••';

  if (loading) {
    return (
      <View
        className="flex-1 justify-center items-center"
        style={{ backgroundColor: colors.surface }}
      >
        <ActivityIndicator size="large" color={colors.brand} />
      </View>
    );
  }

  return (
    <View className="flex-1" style={{ backgroundColor: colors.surface, paddingTop: insets.top }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 24 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <TopBar
          name={user?.full_name}
          icons={[
            { name: 'search-outline', onPress: () => router.push('/(app)/transactions') },
            { name: showBalance ? 'eye-outline' : 'eye-off-outline', onPress: toggleBalance },
            { name: 'notifications-outline' },
          ]}
        />

        <BalanceBlock label="Total Cash Balance" amount={formattedBalance} />

        <ActionRow>
          <CircleAction
            icon="arrow-down"
            label="Deposit"
            onPress={() => router.push('/(app)/fund-wallet')}
          />
          <CircleAction
            icon="arrow-forward"
            label="Withdraw"
            onPress={() => router.push('/(app)/withdraw')}
          />
          <CircleAction
            icon="sync"
            label="Convert"
            onPress={() => router.push('/(app)/convert')}
          />
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
                {showBalance ? `${balance.toLocaleString('en-NG')} NGN` : '•••• NGN'}
              </Text>
            </View>
          </Card>
        </View>

        {/* Savings */}
        <View className="px-5 mb-6">
          <Card>
            <View className="flex-row items-center">
              <View
                className="w-14 h-14 rounded-full items-center justify-center"
                style={{ backgroundColor: colors.circle }}
              >
                <Text style={{ fontSize: 22 }}>📊</Text>
              </View>
              <View className="ml-4 flex-1">
                <Text className="text-ink text-xl font-bold">Your money. Working daily</Text>
                <Text className="text-muted text-sm mt-1">
                  Daily returns in NGN or USD. Flexible or fixed savings
                </Text>
              </View>
            </View>
          </Card>
        </View>

        {/* Transactions */}
        <View className="px-5">
          <SectionHeader title="Transactions" onPress={() => router.push('/(app)/transactions')} />
          <TransactionRow />
        </View>
      </ScrollView>
    </View>
  );
}

function TransactionRow() {
  return (
    <View className="flex-row items-center justify-between py-2">
      <View className="flex-row items-center">
        <NairaFlag size={44} />
        <View className="ml-3">
          <Text className="text-ink text-base font-bold">VICTOR IGWE</Text>
          <Text className="text-muted text-sm">Jun 21, 2026</Text>
        </View>
      </View>
      <Text className="text-ink text-base font-bold">-60,521.3 NGN</Text>
    </View>
  );
}
