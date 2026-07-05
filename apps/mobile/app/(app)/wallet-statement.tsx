import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, TextInput, Share, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { colors, Card } from '@/components/brand';
import { TxnRow } from '@/components/TxnRow';
import { api, getAccessToken, type LedgerTransaction } from '@/services/api';

type WalletOpt = { asset: string; name: string; bg: string; fg: string };

const wallets: WalletOpt[] = [
  { asset: 'NGN', name: 'Naira', bg: '#0B7A3B', fg: '#FFFFFF' },
  { asset: 'BTC', name: 'Bitcoin', bg: '#F7931A', fg: '#FFFFFF' },
  { asset: 'USDT', name: 'Tether', bg: '#26A17B', fg: '#FFFFFF' },
];

export default function WalletStatementScreen() {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<WalletOpt | null>(null);
  const [txns, setTxns] = useState<LedgerTransaction[] | null>(null);

  useEffect(() => {
    if (!selected) return;
    setTxns(null);
    (async () => {
      try {
        if (!(await getAccessToken())) return;
        const { transactions } = await api.getTransactions(100);
        setTxns(transactions.filter((t) => t.asset === selected.asset));
      } catch {
        setTxns([]);
      }
    })();
  }, [selected]);

  const share = async () => {
    if (!selected || !txns) return;
    const header = `CheqPay ${selected.name} (${selected.asset}) statement\n\n`;
    const lines = txns
      .map((t) => `${new Date(t.createdAt).toLocaleDateString()}  ${t.type}  ${t.amountFormatted} ${t.asset}  ${t.status}`)
      .join('\n');
    await Share.share({ message: header + (lines || 'No transactions.') });
  };

  const filtered = wallets.filter(
    (w) =>
      w.name.toLowerCase().includes(query.toLowerCase()) ||
      w.asset.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <View className="flex-1" style={{ backgroundColor: colors.surface, paddingTop: insets.top + 8 }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}
      >
        <TouchableOpacity
          onPress={() => (selected ? setSelected(null) : router.back())}
          className="w-11 h-11 rounded-full bg-card items-center justify-center"
        >
          <Ionicons name="arrow-back" size={22} color={colors.ink} />
        </TouchableOpacity>

        {!selected ? (
          <>
            <Text className="text-ink text-4xl font-extrabold mt-6 mb-5">Select wallet</Text>

            <View
              className="flex-row items-center rounded-2xl px-4 py-3 mb-5"
              style={{ borderWidth: 1, borderColor: colors.border }}
            >
              <Ionicons name="search" size={20} color={colors.muted} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search"
                placeholderTextColor={colors.muted}
                className="text-ink text-base flex-1 ml-3"
                style={{ padding: 0 }}
              />
            </View>

            <View className="bg-card rounded-3xl px-4">
              {filtered.map((w, i) => (
                <TouchableOpacity
                  key={w.asset}
                  onPress={() => setSelected(w)}
                  className="flex-row items-center py-4"
                  style={i > 0 ? { borderTopWidth: 1, borderTopColor: colors.border } : undefined}
                >
                  <View
                    className="w-11 h-11 rounded-full items-center justify-center"
                    style={{ backgroundColor: w.bg }}
                  >
                    <Text className="font-bold" style={{ color: w.fg }}>
                      {w.asset === 'NGN' ? '₦' : w.asset[0]}
                    </Text>
                  </View>
                  <View className="ml-3">
                    <Text className="text-ink text-lg font-bold">{w.name}</Text>
                    <Text className="text-muted text-sm">{w.asset}</Text>
                  </View>
                </TouchableOpacity>
              ))}
              {filtered.length === 0 && (
                <Text className="text-muted text-sm text-center py-6">No wallets found.</Text>
              )}
            </View>
          </>
        ) : (
          <>
            <View className="flex-row items-center justify-between mt-6 mb-5">
              <Text className="text-ink text-3xl font-extrabold">{selected.name}</Text>
              <TouchableOpacity
                onPress={share}
                className="flex-row items-center rounded-full px-4 py-2 bg-card"
              >
                <Ionicons name="share-outline" size={18} color={colors.ink} />
                <Text className="text-ink text-sm font-semibold ml-2">Share</Text>
              </TouchableOpacity>
            </View>

            {!txns ? (
              <View className="py-12 items-center">
                <ActivityIndicator color={colors.brand} />
              </View>
            ) : txns.length === 0 ? (
              <Card>
                <Text className="text-muted text-sm text-center py-2">
                  No {selected.asset} transactions yet.
                </Text>
              </Card>
            ) : (
              <Card>
                {txns.map((t, i) => (
                  <TxnRow key={t.id} t={t} divider={i > 0} />
                ))}
              </Card>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}
