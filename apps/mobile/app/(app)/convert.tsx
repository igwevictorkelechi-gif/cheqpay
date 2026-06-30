import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Modal } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { colors } from '@/components/brand';
import { api } from '@/services/api';
import {
  ASSET_META,
  CONVERT_ASSETS,
  formatMinor,
  type ConvertSymbol,
} from '@/lib/assets';

function CoinBadge({ symbol, size = 40 }: { symbol: ConvertSymbol; size?: number }) {
  const m = ASSET_META[symbol];
  return (
    <View
      className="rounded-full items-center justify-center"
      style={{ backgroundColor: m.bg, width: size, height: size }}
    >
      <Text style={{ color: '#FFFFFF', fontSize: size * 0.45, fontWeight: '700' }}>{m.glyph}</Text>
    </View>
  );
}

function resolveMode(from: ConvertSymbol, to: ConvertSymbol) {
  if (from === 'NGN') return { kind: 'buy' as const, crypto: to as 'BTC' | 'USDT' };
  if (to === 'NGN') return { kind: 'sell' as const, crypto: from as 'BTC' | 'USDT' };
  return { kind: 'convert' as const, crypto: from as 'BTC' | 'USDT' };
}

const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del'];

function AssetCard({
  role,
  symbol,
  amount,
  balance,
  emphasize,
  onPick,
}: {
  role: string;
  symbol: ConvertSymbol;
  amount: string;
  balance: string;
  emphasize?: boolean;
  onPick: () => void;
}) {
  return (
    <View className="bg-card rounded-3xl p-5">
      <View className="flex-row items-center justify-between">
        <TouchableOpacity className="flex-row items-center" activeOpacity={0.7} onPress={onPick}>
          <CoinBadge symbol={symbol} />
          <Text className="text-ink text-lg font-bold ml-2">{symbol}</Text>
          <Ionicons name="chevron-down" size={16} color={colors.muted} style={{ marginLeft: 4 }} />
        </TouchableOpacity>
        <Text className="text-muted text-xs font-semibold" style={{ letterSpacing: 2 }}>{role}</Text>
      </View>
      <Text className="text-ink font-extrabold text-center mt-3" style={{ fontSize: emphasize ? 40 : 34 }} numberOfLines={1}>
        {amount}
      </Text>
      <Text className="text-muted text-sm text-center mt-2">
        Balance: <Text className="text-ink font-semibold">{balance}</Text>
      </Text>
    </View>
  );
}

export default function ConvertScreen() {
  const insets = useSafeAreaInsets();
  const [fromSym, setFromSym] = useState<ConvertSymbol>('NGN');
  const [toSym, setToSym] = useState<ConvertSymbol>('BTC');
  const [amount, setAmount] = useState('0');
  const [out, setOut] = useState('0');
  const [rate, setRate] = useState<string | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState<null | 'from' | 'to'>(null);
  const [bal, setBal] = useState<Record<string, string>>({});

  useEffect(() => {
    (async () => {
      try {
        await api.ensureProvisioned();
        const { balances } = await api.getBalances();
        const b: Record<string, string> = {};
        for (const x of balances) b[x.asset] = x.availableFormatted;
        setBal(b);
      } catch {
        /* ignore */
      }
    })();
  }, []);

  function choose(side: 'from' | 'to', sym: ConvertSymbol) {
    setPicker(null);
    if (side === 'from') {
      if (sym === fromSym) return;
      if (sym === toSym) setToSym(fromSym);
      setFromSym(sym);
    } else {
      if (sym === toSym) return;
      if (sym === fromSym) setFromSym(toSym);
      setToSym(sym);
    }
    setAmount('0');
    setOut('0');
    setRate(null);
    setError(null);
  }

  function flip() {
    setFromSym(toSym);
    setToSym(fromSym);
    setAmount('0');
    setOut('0');
    setRate(null);
    setError(null);
  }

  const mode = resolveMode(fromSym, toSym);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requote = useCallback((amt: string, f: ConvertSymbol, t: ConvertSymbol) => {
    if (debounce.current) clearTimeout(debounce.current);
    if (!(parseFloat(amt) > 0)) {
      setOut('0');
      setRate(null);
      setError(null);
      return;
    }
    debounce.current = setTimeout(async () => {
      setQuoting(true);
      setError(null);
      try {
        const m = resolveMode(f, t);
        const q =
          m.kind === 'convert'
            ? await api.createConvertQuote(f as 'BTC' | 'USDT', t as 'BTC' | 'USDT', amt)
            : await api.createQuote(m.kind, m.crypto, amt);
        setOut(formatMinor(q.amountOut, t));
        setRate(q.rate);
      } catch (e) {
        setOut('0');
        setRate(null);
        setError(e instanceof Error ? e.message : 'Could not get a rate');
      } finally {
        setQuoting(false);
      }
    }, 400);
  }, []);

  useEffect(() => {
    requote(amount, fromSym, toSym);
  }, [amount, fromSym, toSym, requote]);

  const press = (key: string) => {
    setAmount((prev) => {
      if (key === 'del') return prev.length <= 1 ? '0' : prev.slice(0, -1);
      if (key === '.') return prev.includes('.') ? prev : prev + '.';
      const next = (prev === '0' ? key : prev + key).replace(/^0+(\d)/, '$1');
      return next.length > 14 ? prev : next;
    });
  };

  const canPreview = parseFloat(amount) > 0 && !!rate && !error;

  const rateLine = error
    ? error
    : !rate
    ? 'Enter an amount to see the rate'
    : mode.kind === 'convert'
    ? `1 ${fromSym} ≈ ${Number(rate).toLocaleString('en-US', { maximumFractionDigits: 8 })} ${toSym}`
    : `1 ${mode.crypto} ≈ ₦${Number(rate).toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;

  return (
    <View className="flex-1" style={{ backgroundColor: colors.surface, paddingTop: insets.top }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
        <View className="flex-row items-center px-5 pt-3 pb-2">
          <TouchableOpacity
            onPress={() => router.back()}
            className="w-10 h-10 rounded-full bg-card items-center justify-center"
          >
            <Ionicons name="chevron-back" size={22} color={colors.ink} />
          </TouchableOpacity>
          <Text className="flex-1 text-center text-ink text-lg font-bold" style={{ paddingRight: 40 }}>
            Convert
          </Text>
        </View>

        <View className="px-5">
          <AssetCard role="FROM" symbol={fromSym} amount={amount} balance={`${bal[fromSym] ?? '0'} ${fromSym}`} emphasize onPick={() => setPicker('from')} />
          <View className="items-center z-10" style={{ marginVertical: -16 }}>
            <TouchableOpacity onPress={flip} className="w-12 h-12 rounded-full items-center justify-center" style={{ backgroundColor: colors.brand }} activeOpacity={0.8}>
              <Ionicons name="swap-vertical" size={20} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
          <AssetCard role="TO" symbol={toSym} amount={quoting ? '…' : out} balance={`${bal[toSym] ?? '0'} ${toSym}`} onPick={() => setPicker('to')} />
        </View>

        <Text className="text-center text-sm mt-3 px-5" style={{ color: error ? '#FF6B6B' : colors.muted }}>
          {rateLine}
        </Text>

        <View className="flex-row flex-wrap px-5 mt-3" style={{ gap: 12 }}>
          {keys.map((key) => (
            <TouchableOpacity key={key} onPress={() => press(key)} className="bg-card rounded-2xl items-center justify-center" style={{ width: '31.5%', height: 56 }} activeOpacity={0.7}>
              {key === 'del' ? (
                <Ionicons name="backspace-outline" size={22} color={colors.ink} />
              ) : (
                <Text className="text-ink text-xl font-semibold">{key}</Text>
              )}
            </TouchableOpacity>
          ))}
        </View>

        <View className="px-5 mt-6">
          <TouchableOpacity
            disabled={!canPreview}
            className="rounded-full py-4 items-center"
            style={{ backgroundColor: colors.brand, opacity: canPreview ? 1 : 0.5 }}
            activeOpacity={0.85}
            onPress={() =>
              router.push({ pathname: '/(app)/swap-confirm', params: { amount, fromSym, toSym } })
            }
          >
            <Text className="text-white text-base font-bold">Preview Swap</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <Modal visible={!!picker} transparent animationType="slide" onRequestClose={() => setPicker(null)}>
        <TouchableOpacity className="flex-1 justify-end" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }} activeOpacity={1} onPress={() => setPicker(null)}>
          <View className="bg-surface rounded-t-3xl p-5" style={{ paddingBottom: insets.bottom + 16 }}>
            <Text className="text-ink text-lg font-bold mb-4">Select asset</Text>
            {CONVERT_ASSETS.map((sym) => (
              <TouchableOpacity key={sym} onPress={() => picker && choose(picker, sym)} className="flex-row items-center bg-card rounded-2xl p-3 mb-2" activeOpacity={0.7}>
                <CoinBadge symbol={sym} />
                <View className="ml-3 flex-1">
                  <Text className="text-ink font-bold">{sym}</Text>
                  <Text className="text-muted text-xs">{ASSET_META[sym].name}</Text>
                </View>
                <Text className="text-muted text-sm">{bal[sym] ?? '0'} {sym}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}
