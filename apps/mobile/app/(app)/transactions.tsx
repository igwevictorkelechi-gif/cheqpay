import { useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { useAuthStore } from '@/store';
import { walletService } from '@/services/wallet';
import { Transaction, TRANSACTION_TYPES } from '@cheqpay/shared';

export default function TransactionsScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadTransactions();
  }, [user?.id]);

  const loadTransactions = async () => {
    if (!user?.id) return;
    try {
      setLoading(true);
      const data = await walletService.getTransactions(user.id);
      if (data) setTransactions(data);
    } catch (error) {
      console.error('Error loading transactions:', error);
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadTransactions();
    setRefreshing(false);
  };

  const getTransactionIcon = (type: string) => {
    const typeMap: Record<string, string> = {
      credit: 'arrow-down',
      debit: 'arrow-up',
      transfer: 'swap-horizontal',
      withdrawal: 'arrow-up',
      airtime: 'call',
      bills: 'document',
    };
    return typeMap[type] || 'swap-horizontal';
  };

  const renderTransaction = ({ item }: { item: Transaction }) => {
    const txType = TRANSACTION_TYPES[item.type as keyof typeof TRANSACTION_TYPES];
    const icon = getTransactionIcon(item.type);
    const isCredit = item.type === 'credit';

    return (
      <View className="flex-row items-center justify-between px-6 py-4 border-b border-gray-100">
        {/* Icon and Details */}
        <View className="flex-row items-center flex-1">
          <View
            className="w-12 h-12 rounded-full items-center justify-center mr-4"
            style={{ backgroundColor: (txType?.color || '#000000') + '20' }}
          >
            <Ionicons
              name={icon as any}
              size={20}
              color={txType?.color || '#000000'}
            />
          </View>
          <View className="flex-1">
            <Text className="text-gray-800 font-semibold">{txType?.label || item.type}</Text>
            <Text className="text-gray-500 text-xs">
              {format(new Date(item.created_at), 'MMM dd, yyyy HH:mm')}
            </Text>
          </View>
        </View>

        {/* Amount */}
        <Text
          className={`font-bold text-lg ${
            isCredit ? 'text-green-600' : 'text-gray-800'
          }`}
        >
          {isCredit ? '+' : '-'}₦{item.amount.toLocaleString()}
        </Text>
      </View>
    );
  };

  if (loading) {
    return (
      <View className="flex-1 bg-white justify-center items-center" style={{ paddingTop: insets.top }}>
        <ActivityIndicator size="large" color="#10B981" />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-white" style={{ paddingTop: insets.top }}>
      {/* Header */}
      <View className="px-6 py-4">
        <Text className="text-gray-800 text-2xl font-bold">Transaction History</Text>
      </View>

      {/* Transactions List */}
      <FlatList
        data={transactions}
        renderItem={renderTransaction}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          <View className="flex-1 items-center justify-center py-20">
            <Ionicons name="swap-horizontal" size={48} color="#D1D5DB" />
            <Text className="text-gray-500 mt-4 text-center">
              No transactions yet.{'\n'}Start by funding your wallet!
            </Text>
          </View>
        }
        scrollEnabled={transactions.length > 0}
      />
    </View>
  );
}
