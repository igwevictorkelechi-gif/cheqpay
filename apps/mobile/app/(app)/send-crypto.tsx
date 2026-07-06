import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, TextInput, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { colors } from '@/components/brand';
import { api, ApiError } from '@/services/api';
import { ASSET_META, CRYPTO_SEND, isAssetEnabled } from '@/lib/assets';

type Sym = 'BTC' | 'USDT';
const ASSETS: Sym[] = ['BTC', 'USDT'];
type Stage = 'pick' | 'form' | 'review' | 'checking' | 'done';

export default function SendCryptoScreen() {
  const insets = useSafeAreaInsets();
  const [bal, setBal] = useState<Record<string, string>>({});
  const [sym, setSym] = useState<Sym | null>(null);
  const [toAddress, setToAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [stage, setStage] = useState<Stage>('pick');
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | undefined>();

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

  const meta = sym ? ASSET_META[sym] : null;
  const info = sym ? CRYPTO_SEND[sym] : null;
  const available = sym ? Number(bal[sym] ?? 0) : 0;
  const amountNum = Number(amount || 0);
  const min = info ? Number(info.minSend) : 0;
  const valid =
    toAddress.trim().length >= 20 && amountNum >= min && amountNum <= available && amountNum > 0;

  function goReview() {
    setError(null);
    if (toAddress.trim().length < 20) return setError('Enter a valid destination address.');
    if (amountNum < min) return setError(`Minimum send is ${info!.minSend} ${sym}.`);
    if (amountNum > available) return setError('Amount exceeds your available balance.');
    setStage('review');
  }

  async function confirmSend() {
    setError(null);
    setStage('checking');
    await new Promise((r) => setTimeout(r, 1600));
    try {
      const res = await api.createCryptoWithdrawal({
        asset: sym!,
        network: info!.network,
        toAddress: toAddress.trim(),
        amount: amount.trim(),
      });
      setTxHash(res.txHash);
      setStage('done');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not complete the transfer.');
      setStage('review');
    }
  }

  const Header = (title: string, onBack: () => void) => (
    <View className="flex-row items-center px-5 pt-3 pb-2">
      <TouchableOpacity onPress={onBack} className="w-10 h-10 rounded-full bg-card items-center justify-center">
        <Ionicons name="chevron-back" size={22} color={colors.ink} />
      </TouchableOpacity>
      <Text className="text-ink text-lg font-bold ml-3">{title}</Text>
    </View>
  );

  // Picker
  if (stage === 'pick') {
    return (
      <View className="flex-1" style={{ backgroundColor: colors.surface, paddingTop: insets.top }}>
        {Header('Send crypto', () => router.back())}
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32 }}>
          <Text className="text-muted text-sm mt-2 mb-2">Choose the crypto you want to send.</Text>
          <View className="rounded-3xl overflow-hidden" style={{ backgroundColor: colors.card }}>
            {ASSETS.map((s, i) => {
              const m = ASSET_META[s];
              const amt = Number(bal[s] ?? 0);
              const enabled = isAssetEnabled(s);
              return (
                <TouchableOpacity
                  key={s}
                  disabled={!enabled || amt <= 0}
                  onPress={() => {
                    setSym(s);
                    setStage('form');
                  }}
                  className="flex-row items-center px-4 py-4"
                  style={{
                    opacity: enabled && amt > 0 ? 1 : 0.4,
                    ...(i > 0 ? { borderTopWidth: 1, borderTopColor: colors.border } : {}),
                  }}
                >
                  <View className="rounded-full items-center justify-center" style={{ width: 44, height: 44, backgroundColor: m.bg }}>
                    <Text style={{ color: '#fff', fontSize: 20, fontWeight: '700' }}>{m.glyph}</Text>
                  </View>
                  <View className="ml-3 flex-1">
                    <Text className="text-ink text-lg font-bold">{s}</Text>
                    <Text className="text-muted text-sm">{m.name}</Text>
                  </View>
                  {enabled ? (
                    <Text className="text-ink font-bold">{bal[s] ?? '0'} {s}</Text>
                  ) : (
                    <View className="rounded-full px-3 py-1.5" style={{ backgroundColor: 'rgba(107,91,149,0.15)' }}>
                      <Text style={{ color: colors.brandLight, fontSize: 11, fontWeight: '700' }}>Coming soon</Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </ScrollView>
      </View>
    );
  }

  return (
    <View className="flex-1" style={{ backgroundColor: colors.surface, paddingTop: insets.top }}>
      {Header(`Send ${sym}`, () => (stage === 'review' ? setStage('form') : setStage('pick')))}
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32 }}>
        {stage === 'form' && meta && info && (
          <>
            <View className="items-center mt-4">
              <View className="rounded-full items-center justify-center" style={{ width: 56, height: 56, backgroundColor: meta.bg }}>
                <Text style={{ color: '#fff', fontSize: 26, fontWeight: '700' }}>{meta.glyph}</Text>
              </View>
              <Text className="text-muted text-sm mt-3">Available balance</Text>
              <Text className="text-ink text-lg font-bold">{available} {sym}</Text>
            </View>

            <Text className="text-muted text-sm font-semibold mt-6 mb-2">Destination wallet address</Text>
            <TextInput
              value={toAddress}
              onChangeText={setToAddress}
              placeholder={`Paste ${sym} (${info.networkLabel}) address`}
              placeholderTextColor={colors.muted}
              multiline
              className="rounded-2xl px-4 py-3 text-ink"
              style={{ backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, minHeight: 64 }}
            />

            <Text className="text-muted text-sm font-semibold mt-5 mb-2">Amount</Text>
            <View className="flex-row items-center rounded-2xl px-4 py-3" style={{ backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}>
              <TextInput
                value={amount}
                onChangeText={(t) => setAmount(t.replace(/[^\d.]/g, ''))}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={colors.muted}
                className="flex-1 text-ink text-lg font-bold"
              />
              <Text className="text-muted font-bold mr-2">{sym}</Text>
              <TouchableOpacity onPress={() => setAmount(String(available))} className="rounded-full px-3 py-1" style={{ backgroundColor: 'rgba(107,91,149,0.25)' }}>
                <Text style={{ color: colors.brandLight, fontWeight: '700', fontSize: 12 }}>MAX</Text>
              </TouchableOpacity>
            </View>
            <Text className="text-muted text-xs mt-2">Minimum {info.minSend} {sym} · Network {info.networkLabel}</Text>

            {error && <Text style={{ color: '#FF6B6B' }} className="text-sm mt-4">{error}</Text>}

            <View className="rounded-2xl p-4 mt-6 flex-row" style={{ backgroundColor: 'rgba(245,166,35,0.1)', borderWidth: 1, borderColor: 'rgba(245,166,35,0.3)' }}>
              <Ionicons name="warning-outline" size={20} color="#F5A623" />
              <Text className="text-xs ml-3 flex-1" style={{ color: '#F5C97B', lineHeight: 18 }}>
                Double-check the address. Crypto transfers are irreversible and cannot be recovered if
                sent to the wrong address or network.
              </Text>
            </View>

            <TouchableOpacity onPress={goReview} disabled={!valid} className="rounded-full py-4 items-center mt-6" style={{ backgroundColor: colors.brand, opacity: valid ? 1 : 0.4 }}>
              <Text className="text-white font-bold text-base">Continue</Text>
            </TouchableOpacity>
          </>
        )}

        {stage === 'review' && (
          <>
            <Text className="text-muted text-sm font-semibold mt-4 mb-2">Review transfer</Text>
            <View className="rounded-2xl overflow-hidden" style={{ backgroundColor: colors.card }}>
              <ReviewRow label="Asset" value={`${meta?.name} (${sym})`} />
              <ReviewRow label="Network" value={info!.networkLabel} bordered />
              <ReviewRow label="Amount" value={`${amount} ${sym}`} bordered />
              <View className="px-4 py-4" style={{ borderTopWidth: 1, borderTopColor: colors.border }}>
                <Text className="text-muted text-sm">To address</Text>
                <Text className="text-ink text-sm font-semibold mt-1">{toAddress.trim()}</Text>
              </View>
            </View>
            {error && <Text style={{ color: '#FF6B6B' }} className="text-sm mt-4">{error}</Text>}
            <View className="flex-row items-center mt-6">
              <Ionicons name="shield-checkmark-outline" size={16} color={colors.brandLight} />
              <Text className="text-muted text-xs ml-2">Your transfer passes an authentication & security check before approval.</Text>
            </View>
            <TouchableOpacity onPress={confirmSend} className="rounded-full py-4 items-center mt-4" style={{ backgroundColor: colors.brand }}>
              <Text className="text-white font-bold text-base">Confirm & send</Text>
            </TouchableOpacity>
          </>
        )}

        {stage === 'checking' && (
          <View className="items-center mt-16">
            <Ionicons name="shield-checkmark" size={64} color={colors.brandLight} />
            <ActivityIndicator color={colors.brand} style={{ marginTop: 16 }} />
            <Text className="text-ink text-lg font-bold mt-6">Security check</Text>
            <Text className="text-muted text-sm mt-2">Verifying identity · screening address · approving</Text>
          </View>
        )}

        {stage === 'done' && (
          <View className="items-center pt-10">
            <Ionicons name="checkmark-circle" size={72} color={colors.positive} />
            <Text className="text-ink text-2xl font-extrabold mt-6">Transfer submitted</Text>
            <Text className="text-muted text-sm mt-2 text-center">
              {amount} {sym} is on its way to your destination address.
            </Text>
            {txHash ? <Text className="text-muted text-xs mt-3">Tx: {txHash}</Text> : null}
            <TouchableOpacity onPress={() => router.replace('/(app)/crypto')} className="rounded-full py-4 items-center mt-8 w-full" style={{ backgroundColor: colors.brand }}>
              <Text className="text-white font-bold text-base">Done</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function ReviewRow({ label, value, bordered }: { label: string; value: string; bordered?: boolean }) {
  return (
    <View className="flex-row items-center justify-between px-4 py-4" style={bordered ? { borderTopWidth: 1, borderTopColor: colors.border } : undefined}>
      <Text className="text-muted text-sm">{label}</Text>
      <Text className="text-ink text-sm font-semibold" style={{ maxWidth: '60%' }} numberOfLines={1}>{value}</Text>
    </View>
  );
}
