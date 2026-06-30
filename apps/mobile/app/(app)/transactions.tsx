import { useEffect, useState } from 'react';
import { View, Text, FlatList, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@/store';
import { api, ApiError, type LedgerTransaction } from '@/services/api';
import { colors } from '@/components/brand';
import { TxnRow } from '@/components/TxnRow';

export default function TransactionsScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const [txns, setTxns] = useState<LedgerTransaction[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    try {
      const run = () => api.getTransactions(100);
      let res;
      try {
        res = await run();
      } catch (e) {
        if (e instanceof ApiError && (e.status === 404 || e.status === 401)) {
          await api.ensureProvisioned();
          res = await run();
        } else {
          throw e;
        }
      }
      setTxns(res.transactions);
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

  return (
    <View className="flex-1" style={{ backgroundColor: colors.surface, paddingTop: insets.top }}>
      <View className="px-5 py-4 flex-row items-center">
        <Text className="text-ink text-2xl font-extrabold flex-1">Transactions</Text>
      </View>

      <FlatList
        data={txns}
        renderItem={({ item, index }) => <TxnRow t={item} divider={index > 0} />}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />
        }
        ListEmptyComponent={
          <View className="items-center justify-center py-20">
            <Ionicons name="receipt-outline" size={44} color={colors.muted} />
            <Text className="text-muted mt-4 text-center">
              No transactions yet.{'\n'}Start by funding your wallet.
            </Text>
          </View>
        }
      />
    </View>
  );
}
