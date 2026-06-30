import { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { colors } from '@/components/brand';
import { api, ApiError } from '@/services/api';
import { ASSET_META, formatMinor, type ConvertSymbol } from '@/lib/assets';

function CoinBadge({ symbol, size = 44 }: { symbol: string; size?: number }) {
  const m = ASSET_META[symbol as ConvertSymbol] ?? { bg: colors.brand, glyph: symbol.charAt(0) };
  return (
    <View className="rounded-full items-center justify-center" style={{ width: size, height: size, backgroundColor: m.bg }}>
      <Text style={{ color: '#FFFFFF', fontSize: size * 0.45, fontWeight: '700' }}>{m.glyph}</Text>
    </View>
  );
}

function Leg({ caption, amount, symbol }: { caption: string; amount: string; symbol: string }) {
  return (
    <View className="flex-row items-center justify-between">
      <View style={{ flexShrink: 1 }}>
        <Text className="text-muted text-sm">{caption}</Text>
        <Text className="text-ink text-2xl font-extrabold mt-1" numberOfLines={1}>
          {amount} <Text className="text-lg">{symbol}</Text>
        </Text>
      </View>
      <CoinBadge symbol={symbol} />
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center justify-between py-2">
      <Text className="text-muted text-sm">{label}</Text>
      <Text className="text-ink text-sm font-semibold">{value}</Text>
    </View>
  );
}

export default function SwapConfirmScreen() {
  const insets = useSafeAreaInsets();
  const { amount = '0', fromSym = 'NGN', toSym = 'BTC' } = useLocalSearchParams<{
    amount: string;
    fromSym: ConvertSymbol;
    toSym: ConvertSymbol;
  }>();

  const isConvert = fromSym !== 'NGN' && toSym !== 'NGN';
  const side: 'buy' | 'sell' = fromSym === 'NGN' ? 'buy' : 'sell';
  const cryptoAsset = (fromSym === 'NGN' ? toSym : fromSym) as 'BTC' | 'USDT';

  const [quoteId, setQuoteId] = useState<string | null>(null);
  const [out, setOut] = useState('0');
  const [rate, setRate] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchQuote = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await api.ensureProvisioned();
      const q = isConvert
        ? await api.createConvertQuote(fromSym as 'BTC' | 'USDT', toSym as 'BTC' | 'USDT', String(amount))
        : await api.createQuote(side, cryptoAsset, String(amount));
      setQuoteId(q.quoteId);
      setOut(formatMinor(q.amountOut, toSym as ConvertSymbol));
      setRate(q.rate);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not get a quote');
    } finally {
      setLoading(false);
    }
  }, [amount, fromSym, toSym, isConvert, side, cryptoAsset]);

  useEffect(() => {
    fetchQuote();
  }, [fetchQuote]);

  const confirm = async () => {
    if (!quoteId) return;
    setProcessing(true);
    setError(null);
    try {
      await api.executeSwap(quoteId);
      router.replace({ pathname: '/(app)/swap-success', params: { from: String(amount), to: out, fromSym, toSym } });
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Swap failed';
      if (/expired|used|consumed/i.test(msg)) {
        setError('Rate expired. Refreshing…');
        setProcessing(false);
        fetchQuote();
        return;
      }
      setError(msg);
      setProcessing(false);
    }
  };

  const rateValue = !rate
    ? '—'
    : isConvert
    ? `1 ${fromSym} = ${Number(rate).toLocaleString('en-US', { maximumFractionDigits: 8 })} ${toSym}`
    : `1 ${cryptoAsset} = ₦${Number(rate).toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;

  return (
    <View className="flex-1" style={{ backgroundColor: colors.surface, paddingTop: insets.top }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
        <View className="flex-row items-center px-5 pt-3 pb-2">
          <TouchableOpacity onPress={() => router.back()} className="w-10 h-10 rounded-full bg-card items-center justify-center">
            <Ionicons name="chevron-back" size={22} color={colors.ink} />
          </TouchableOpacity>
          <Text className="flex-1 text-center text-ink text-lg font-bold" style={{ paddingRight: 40 }}>
            Confirm Swap
          </Text>
        </View>

        <View className="px-5">
          <View className="bg-card rounded-3xl p-5">
            <Leg caption="You pay" amount={String(amount)} symbol={String(fromSym)} />
            <View className="items-center my-4">
              <View className="w-9 h-9 rounded-full items-center justify-center" style={{ backgroundColor: colors.brand }}>
                <Ionicons name="arrow-down" size={16} color="#FFFFFF" />
              </View>
            </View>
            <Leg caption="You receive" amount={loading ? '…' : out} symbol={String(toSym)} />
          </View>
        </View>

        <View className="px-5 mt-4">
          <View className="bg-card rounded-3xl p-5">
            <Row label="Rate" value={rateValue} />
            <Row label="Estimated time" value="~ instant" />
            <View style={{ height: 1, backgroundColor: colors.border, marginVertical: 4 }} />
            <Row label="You receive" value={loading ? '…' : `${out} ${toSym}`} />
          </View>
        </View>

        {error && <Text className="text-center text-sm mt-4 px-5" style={{ color: '#FF6B6B' }}>{error}</Text>}

        <View className="px-5 mt-6">
          <TouchableOpacity
            onPress={confirm}
            disabled={processing || loading || !quoteId}
            className="rounded-full py-4 items-center"
            style={{ backgroundColor: colors.brand, opacity: processing || loading || !quoteId ? 0.6 : 1 }}
            activeOpacity={0.85}
          >
            <Text className="text-white text-base font-bold">
              {processing ? 'Swapping…' : loading ? 'Getting rate…' : 'Confirm Swap'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.back()} disabled={processing} className="py-3 items-center mt-1">
            <Text className="text-muted text-base font-semibold">Cancel</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}
