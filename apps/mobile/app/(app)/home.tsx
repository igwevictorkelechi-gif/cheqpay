import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useAuthStore, useWalletStore, useUIStore } from '@/store';
import { walletService } from '@/services/wallet';

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const { wallet, virtualAccount, setWallet, setVirtualAccount } = useWalletStore();
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

  const quickActions = [
    {
      id: 'fund',
      name: 'Fund Wallet',
      icon: 'arrow-down-circle',
      color: '#10B981',
      route: '/(app)/fund-wallet',
    },
    {
      id: 'send',
      name: 'Send Money',
      icon: 'send',
      color: '#3B82F6',
      route: '/(app)/send-money',
    },
    {
      id: 'withdraw',
      name: 'Withdraw',
      icon: 'arrow-up-circle',
      color: '#EF4444',
      route: '/(app)/withdraw',
    },
    {
      id: 'airtime',
      name: 'Airtime',
      icon: 'call',
      color: '#F59E0B',
      route: '/(app)/airtime',
    },
  ];

  if (loading) {
    return (
      <View className="flex-1 bg-white justify-center items-center">
        <ActivityIndicator size="large" color="#10B981" />
      </View>
    );
  }

  return (
    <ScrollView
      className="flex-1 bg-gradient-to-b from-green-50 to-white"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {/* Header */}
      <View className="bg-white" style={{ paddingTop: insets.top }}>
        <View className="px-6 py-4">
          <Text className="text-gray-500 text-sm">Welcome back,</Text>
          <Text className="text-gray-800 text-2xl font-bold">{user?.full_name}</Text>
        </View>
      </View>

      {/* Wallet Card */}
      <View className="px-6 mt-6 mb-8">
        <View className="bg-gradient-to-r from-green-600 to-green-500 rounded-3xl p-8 shadow-lg">
          {/* Balance Header */}
          <View className="flex-row justify-between items-center mb-8">
            <Text className="text-green-100 text-sm font-semibold">Wallet Balance</Text>
            <TouchableOpacity onPress={toggleBalance}>
              <Ionicons
                name={showBalance ? 'eye' : 'eye-off'}
                size={24}
                color="white"
              />
            </TouchableOpacity>
          </View>

          {/* Balance */}
          <View className="mb-8">
            <Text className="text-white text-5xl font-bold">
              {showBalance ? '₦' + (wallet?.balance || 0).toLocaleString() : '••••'}
            </Text>
          </View>

          {/* Virtual Account Info */}
          <View className="border-t border-green-400 pt-4">
            <Text className="text-green-100 text-xs font-semibold mb-2">Your Virtual Account</Text>
            <View className="flex-row justify-between items-center">
              <View>
                <Text className="text-white text-sm font-semibold">
                  {virtualAccount?.bank_name || 'Loading...'}
                </Text>
                <Text className="text-green-100 text-lg font-bold">
                  {virtualAccount?.account_number || '0000000000'}
                </Text>
              </View>
              {virtualAccount?.account_number && (
                <TouchableOpacity
                  onPress={() => {
                    // Copy to clipboard
                    Alert.alert('Copied', 'Account number copied to clipboard');
                  }}
                >
                  <Ionicons name="copy" size={20} color="white" />
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>
      </View>

      {/* Quick Actions */}
      <View className="px-6 mb-8">
        <Text className="text-gray-800 font-bold text-lg mb-4">Quick Actions</Text>
        <View className="flex-row flex-wrap gap-4">
          {quickActions.map((action) => (
            <TouchableOpacity
              key={action.id}
              className="flex-1 bg-white rounded-2xl p-4 items-center min-w-[40%] shadow"
              onPress={() => router.push(action.route)}
            >
              <View
                className="w-12 h-12 rounded-full items-center justify-center mb-2"
                style={{ backgroundColor: action.color + '20' }}
              >
                <Ionicons name={action.icon as any} size={24} color={action.color} />
              </View>
              <Text className="text-gray-700 font-semibold text-xs text-center">
                {action.name}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Recent Transactions */}
      <View className="px-6 mb-8">
        <View className="flex-row justify-between items-center mb-4">
          <Text className="text-gray-800 font-bold text-lg">Recent Transactions</Text>
          <TouchableOpacity onPress={() => router.push('/(app)/transactions')}>
            <Text className="text-green-600 font-semibold text-sm">See All</Text>
          </TouchableOpacity>
        </View>

        {/* Empty State */}
        <View className="bg-white rounded-2xl p-8 items-center">
          <Ionicons name="swap-horizontal" size={48} color="#D1D5DB" />
          <Text className="text-gray-500 mt-4 text-center">
            No recent transactions.{'\n'}Fund your wallet to get started!
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}
