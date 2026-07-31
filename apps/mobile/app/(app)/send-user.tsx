import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { colors } from '@/components/brand';
import { SuccessAnimation } from '@/components/Lottie';
import { api, ApiError, type Balance } from '@/services/api';
import { useFeatures } from '@/lib/useFeatures';

const ASSETS = ['NGN', 'BTC', 'USDT', 'USDC'];

/**
 * Send NGN or crypto to another CheqPay user by username. The recipient is
 * confirmed before any money moves — the equivalent of a bank name enquiry.
 */
export default function SendToUserScreen() {
  const insets = useSafeAreaInsets();
  const features = useFeatures();

  const [balances, setBalances] = useState<Balance[]>([]);
  const [asset, setAsset] = useState('NGN');
  const [username, setUsername] = useState('');
  const [confirmed, setConfirmed] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ amount: string; asset: string; to: string } | null>(null);

  useEffect(() => {
    api
      .getBalances()
      .then(({ balances }) => setBalances(balances))
      .catch(() => {});
  }, []);

  const available = Number(
    balances.find((b) => b.asset === asset)?.availableFormatted ?? 0
  );

  async function check() {
    setError(null);
    setConfirmed(null);
    setChecking(true);
    try {
      const res = await api.lookupUser(username.replace(/^@+/, ''));
      setConfirmed(res.username);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Couldn’t find that username.');
    } finally {
      setChecking(false);
    }
  }

  async function send() {
    setError(null);
    setSending(true);
    try {
      const res = await api.sendToUser({
        username: confirmed ?? username,
        asset,
        amount,
        note: note.trim() || undefined,
      });
      setSent({ amount: res.amountFormatted, asset: res.asset, to: res.recipient });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Couldn’t send. Please try again.');
    } finally {
      setSending(false);
    }
  }

  const amountNum = Number(amount);
  const amountValid = Number.isFinite(amountNum) && amountNum > 0;
  const overBalance = amountValid && amountNum > available;
  const canSend = !!confirmed && amountValid && !overBalance && !sending;

  const inputStyle = {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: colors.ink,
    fontSize: 16,
  };

  if (sent) {
    return (
      <View className="flex-1" style={{ backgroundColor: colors.surface, paddingTop: insets.top }}>
        <View className="flex-1 items-center justify-center px-8">
          <SuccessAnimation />
          <Text className="text-ink text-2xl font-extrabold mt-6">Money sent</Text>
          <Text className="text-muted text-sm mt-2 text-center">
            {sent.asset === 'NGN' ? '₦' : ''}
            {sent.amount}
            {sent.asset === 'NGN' ? '' : ` ${sent.asset}`} is now in @{sent.to}’s wallet.
          </Text>
        </View>
        <View style={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 24 }}>
          <TouchableOpacity
            onPress={() => router.replace('/(app)/home')}
            className="py-4 rounded-full items-center"
            style={{ backgroundColor: colors.brand }}
          >
            <Text style={{ color: colors.white, fontWeight: '700', fontSize: 16 }}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1"
    >
      <View className="flex-1" style={{ backgroundColor: colors.surface, paddingTop: insets.top }}>
        <View className="flex-row items-center px-5 pt-3 pb-2">
          <TouchableOpacity
            onPress={() => router.back()}
            className="w-10 h-10 rounded-full bg-card items-center justify-center"
          >
            <Ionicons name="chevron-back" size={22} color={colors.ink} />
          </TouchableOpacity>
          <Text className="text-ink text-lg font-bold ml-3">Send to a user</Text>
        </View>

        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}>
          {!features.p2p_transfers ? (
            <View className="items-center py-12">
              <View
                className="w-16 h-16 rounded-full items-center justify-center"
                style={{ backgroundColor: colors.card }}
              >
                <Ionicons name="paper-plane" size={26} color={colors.brandLight} />
              </View>
              <Text className="text-ink text-lg font-bold mt-4">Coming soon</Text>
              <Text className="text-muted text-sm mt-1 text-center px-6">
                Sending to other CheqPay users isn’t switched on yet.
              </Text>
            </View>
          ) : (
            <>
              <Text className="text-muted text-sm mt-1 mb-5">
                Instant and free between CheqPay accounts.
              </Text>

              <Text className="text-muted text-sm font-semibold mb-1.5">Recipient username</Text>
              <View className="flex-row" style={{ gap: 8 }}>
                <TextInput
                  value={username}
                  onChangeText={(t) => {
                    setUsername(t.replace(/^@+/, ''));
                    setConfirmed(null);
                    setError(null);
                  }}
                  placeholder="username"
                  placeholderTextColor={colors.muted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={{ ...inputStyle, flex: 1 }}
                />
                <TouchableOpacity
                  onPress={check}
                  disabled={username.length < 3 || checking || !!confirmed}
                  className="px-4 justify-center rounded-2xl"
                  style={{
                    backgroundColor: colors.card,
                    opacity: username.length < 3 || checking || !!confirmed ? 0.4 : 1,
                  }}
                >
                  {checking ? (
                    <ActivityIndicator color={colors.ink} />
                  ) : (
                    <Text className="text-ink font-bold">Check</Text>
                  )}
                </TouchableOpacity>
              </View>

              {confirmed && (
                <View
                  className="flex-row items-center mt-3 p-4 rounded-2xl"
                  style={{ backgroundColor: 'rgba(52,199,89,0.10)', borderWidth: 1, borderColor: 'rgba(52,199,89,0.3)' }}
                >
                  <Ionicons name="checkmark-circle" size={20} color={colors.positive} />
                  <Text className="text-ink font-bold ml-2">Sending to @{confirmed}</Text>
                </View>
              )}

              <Text className="text-muted text-sm font-semibold mt-6 mb-2">Asset</Text>
              <View className="flex-row flex-wrap" style={{ gap: 8 }}>
                {ASSETS.map((a) => (
                  <TouchableOpacity
                    key={a}
                    onPress={() => {
                      setAsset(a);
                      setAmount('');
                    }}
                    className="px-4 py-2 rounded-full"
                    style={{ backgroundColor: asset === a ? colors.brand : colors.card }}
                  >
                    <Text
                      style={{
                        color: asset === a ? colors.white : colors.muted,
                        fontWeight: '700',
                        fontSize: 13,
                      }}
                    >
                      {a}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text className="text-muted text-sm font-semibold mt-6 mb-1.5">Amount</Text>
              <TextInput
                value={amount}
                onChangeText={(t) => {
                  setAmount(t.replace(/[^\d.]/g, ''));
                  setError(null);
                }}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={colors.muted}
                style={inputStyle}
              />
              <Text className="text-muted text-xs mt-1.5">
                Available: {asset === 'NGN' ? '₦' : ''}
                {available.toLocaleString('en-NG', { maximumFractionDigits: 8 })}
                {asset === 'NGN' ? '' : ` ${asset}`}
              </Text>

              <Text className="text-muted text-sm font-semibold mt-5 mb-1.5">Note (optional)</Text>
              <TextInput
                value={note}
                onChangeText={setNote}
                maxLength={140}
                placeholder="What’s it for?"
                placeholderTextColor={colors.muted}
                style={inputStyle}
              />

              {(error || overBalance) && (
                <Text style={{ color: '#F87171', marginTop: 16 }}>
                  {error ?? `That's more than your ${asset} balance.`}
                </Text>
              )}

              <TouchableOpacity
                onPress={send}
                disabled={!canSend}
                className="mt-8 flex-row items-center justify-center py-4 rounded-full"
                style={{ backgroundColor: colors.brand, opacity: canSend ? 1 : 0.5 }}
              >
                {sending && <ActivityIndicator color={colors.white} style={{ marginRight: 8 }} />}
                <Text style={{ color: colors.white, fontWeight: '700', fontSize: 16 }}>
                  {sending ? 'Sending…' : 'Send'}
                </Text>
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}
