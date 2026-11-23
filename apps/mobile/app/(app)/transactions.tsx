import { useEffect, useState } from 'react';
import { View, Text, ScrollView, RefreshControl, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useAuthStore } from '@/store';
import { api, ApiError, type LedgerTransaction } from '@/services/api';
import { colors } from '@/components/brand';
import ActivityList from '@/components/ActivityList';

export default function TransactionsScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  // `currency=USD` narrows the history, so the home screen's currency tab
  // carries through to "See all".
  const { currency } = useLocalSearchParams<{ currency?: string }>();
  const asset = String(currency ?? '').toUpperCase() === 'USD' ? 'USD' : undefined;
  const [txns, setTxns] = useState<LedgerTransaction[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    try {
      const run = () => api.getTransactions(100, asset);
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
  }, [user?.id, asset]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  return (
    <View className="flex-1" style={{ backgroundColor: colors.surface, paddingTop: insets.top }}>
      <View className="px-5 py-4 flex-row items-center">
        <TouchableOpacity
          onPress={() => router.back()}
          className="w-11 h-11 rounded-full items-center justify-center mr-3"
          style={{ backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}
          accessibilityLabel="Back"
        >
          <Ionicons name="chevron-back" size={20} color={colors.ink} />
        </TouchableOpacity>
        <Text style={{ color: colors.ink, fontSize: 24, fontWeight: '700', letterSpacing: -0.5, flex: 1 }}>
          {asset === 'USD' ? 'Dollar activity' : 'Activity'}
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />}
      >
        {txns.length === 0 ? (
          <View className="items-center justify-center py-20">
            <Ionicons name="receipt-outline" size={44} color={colors.muted} />
            <Text style={{ color: colors.muted, marginTop: 16, textAlign: 'center' }}>
              No transactions yet.{'\n'}Start by funding your wallet.
            </Text>
          </View>
        ) : (
          <ActivityList txns={txns} />
        )}
      </ScrollView>
    </View>
  );
}
