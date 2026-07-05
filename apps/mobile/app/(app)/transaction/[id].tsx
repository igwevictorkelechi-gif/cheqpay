import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Share, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { colors } from '@/components/brand';
import { txnIcon, txnTitle, txnAmount, fmt } from '@/components/TxnRow';
import { api, getAccessToken, type LedgerTransaction } from '@/services/api';

const STATUS_COLOR: Record<string, string> = {
  COMPLETED: '#34C759',
  PENDING: '#F5A623',
  PROCESSING: '#F5A623',
  FAILED: '#EF4444',
  REVERSED: '#EF4444',
};

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View className="flex-row items-start justify-between py-3" style={{ borderTopWidth: 1, borderTopColor: colors.border }}>
      <Text className="text-muted text-sm">{label}</Text>
      <Text
        className="text-ink text-sm font-semibold text-right flex-1 ml-4"
        style={mono ? { fontFamily: 'monospace' } : undefined}
        numberOfLines={mono ? 1 : undefined}
      >
        {value}
      </Text>
    </View>
  );
}

export default function TransactionDetailScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [tx, setTx] = useState<LedgerTransaction | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        if (!(await getAccessToken()) || !id) return;
        const { transaction } = await api.getTransaction(id);
        setTx(transaction);
      } catch {
        setNotFound(true);
      }
    })();
  }, [id]);

  const share = async () => {
    if (!tx) return;
    const amt = txnAmount(tx);
    const when = new Date(tx.createdAt).toLocaleString('en-NG');
    const lines = [
      'CheqPay receipt',
      '',
      `${txnTitle(tx)}`,
      `Amount: ${amt.text}`,
      `Status: ${tx.status}`,
      `Date: ${when}`,
      tx.fromFormatted && tx.toFormatted ? `From: ${fmt(tx.fromFormatted)} ${tx.fromAsset}` : '',
      tx.fromFormatted && tx.toFormatted ? `To: ${fmt(tx.toFormatted)} ${tx.toAsset}` : '',
      tx.customer ? `Recipient: ${tx.customer}` : '',
      tx.toAddress ? `Address: ${tx.toAddress}` : '',
      tx.txHash ? `Tx hash: ${tx.txHash}` : '',
      `Reference: ${tx.id}`,
    ].filter(Boolean);
    await Share.share({ message: lines.join('\n') });
  };

  const statusColor = tx ? STATUS_COLOR[tx.status] ?? colors.muted : colors.muted;

  return (
    <View className="flex-1" style={{ backgroundColor: colors.surface, paddingTop: insets.top + 8 }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}
      >
        <View className="flex-row items-center justify-between">
          <TouchableOpacity
            onPress={() => router.back()}
            className="w-11 h-11 rounded-full bg-card items-center justify-center"
          >
            <Ionicons name="arrow-back" size={22} color={colors.ink} />
          </TouchableOpacity>
          {tx && (
            <TouchableOpacity
              onPress={share}
              className="flex-row items-center rounded-full px-4 py-2.5 bg-card"
            >
              <Ionicons name="share-outline" size={18} color={colors.ink} />
              <Text className="text-ink text-sm font-semibold ml-2">Share</Text>
            </TouchableOpacity>
          )}
        </View>

        {notFound ? (
          <Text className="text-muted text-center mt-20">Transaction not found.</Text>
        ) : !tx ? (
          <View className="py-24 items-center">
            <ActivityIndicator color={colors.brand} />
          </View>
        ) : (
          <>
            {/* Header */}
            <View className="items-center mt-6 mb-2">
              <View
                className="w-16 h-16 rounded-full items-center justify-center"
                style={{ backgroundColor: txnIcon(tx.type).bg }}
              >
                <Ionicons name={txnIcon(tx.type).name} size={30} color={txnIcon(tx.type).color} />
              </View>
              <Text className="text-ink text-3xl font-extrabold mt-4" style={{ color: txnAmount(tx).positive ? colors.positive : colors.ink }}>
                {txnAmount(tx).text}
              </Text>
              <Text className="text-muted text-base mt-1">{txnTitle(tx)}</Text>
              <View className="rounded-full px-3 py-1 mt-3" style={{ backgroundColor: statusColor + '22' }}>
                <Text className="text-xs font-bold" style={{ color: statusColor }}>{tx.status}</Text>
              </View>
            </View>

            {/* Details */}
            <View className="bg-card rounded-3xl px-4 mt-6">
              <View className="flex-row items-start justify-between py-3">
                <Text className="text-muted text-sm">Type</Text>
                <Text className="text-ink text-sm font-semibold">{tx.type}</Text>
              </View>
              <Row label="Date" value={new Date(tx.createdAt).toLocaleString('en-NG')} />
              {tx.fromFormatted && tx.toFormatted && (
                <>
                  <Row label="From" value={`${fmt(tx.fromFormatted)} ${tx.fromAsset}`} />
                  <Row label="To" value={`${fmt(tx.toFormatted)} ${tx.toAsset}`} />
                </>
              )}
              {!!tx.rate && <Row label="Rate" value={tx.rate} />}
              {!!tx.network && <Row label="Network" value={tx.network} />}
              {!!tx.billerName && <Row label="Biller" value={tx.billerName} />}
              {!!tx.planName && <Row label="Plan" value={tx.planName} />}
              {!!tx.customer && <Row label="Recipient" value={tx.customer} />}
              {Number(tx.feeFormatted) > 0 && <Row label="Fee" value={`${fmt(tx.feeFormatted)} ${tx.asset}`} />}
              {!!tx.toAddress && <Row label="Address" value={tx.toAddress} mono />}
              {!!tx.txHash && <Row label="Tx hash" value={tx.txHash} mono />}
              <Row label="Reference" value={tx.id} mono />
            </View>

            <TouchableOpacity
              onPress={share}
              className="rounded-full py-4 items-center mt-6 flex-row justify-center"
              style={{ backgroundColor: colors.brand }}
            >
              <Ionicons name="share-outline" size={20} color="#FFFFFF" />
              <Text className="text-white text-base font-bold ml-2">Share receipt</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </View>
  );
}
