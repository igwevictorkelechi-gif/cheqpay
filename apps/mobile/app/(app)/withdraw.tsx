import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { NIGERIAN_BANKS } from '@cheqpay/shared';
import { colors } from '@/components/brand';
import { api, ApiError } from '@/services/api';

type Stage = 'form' | 'done';

export default function WithdrawScreen() {
  const insets = useSafeAreaInsets();
  const [balance, setBalance] = useState(0);
  const [bankCode, setBankCode] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [showBanks, setShowBanks] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>('form');

  useEffect(() => {
    (async () => {
      try {
        await api.ensureProvisioned();
        const { balances } = await api.getBalances();
        setBalance(Number(balances.find((b) => b.asset === 'NGN')?.availableFormatted ?? 0));
      } catch {
        /* ignore */
      }
    })();
  }, []);

  const amt = parseFloat(amount || '0') || 0;
  const bankName = NIGERIAN_BANKS.find((b) => b.code === bankCode)?.name;
  const valid = !!bankCode && /^\d{10}$/.test(accountNumber) && amt >= 100 && amt <= balance;

  async function submit() {
    setError(null);
    if (!bankCode) return setError('Select a bank.');
    if (!/^\d{10}$/.test(accountNumber)) return setError('Enter a valid 10-digit account number.');
    if (amt < 100) return setError('Minimum withdrawal is ₦100.');
    if (amt > balance) return setError('Insufficient NGN balance.');
    setLoading(true);
    try {
      await api.createNgnWithdrawal({
        amount: String(amt),
        bankCode,
        accountNumber,
        narration: 'CheqPay withdrawal',
      });
      setStage('done');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Withdrawal failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  if (stage === 'done') {
    return (
      <View
        className="flex-1 px-5 items-center"
        style={{ backgroundColor: colors.surface, paddingTop: insets.top + 40 }}
      >
        <Ionicons name="checkmark-circle" size={72} color={colors.positive} />
        <Text className="text-ink text-2xl font-extrabold mt-6">Withdrawal submitted</Text>
        <Text className="text-muted text-sm mt-2 text-center">
          ₦{amt.toLocaleString()} is on its way to {bankName} · {accountNumber}.
        </Text>
        <TouchableOpacity
          onPress={() => router.replace('/(app)/home')}
          className="rounded-full py-4 items-center mt-8 w-full"
          style={{ backgroundColor: colors.brand }}
        >
          <Text className="text-white font-bold text-base">Done</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1">
      <View className="flex-1" style={{ backgroundColor: colors.surface, paddingTop: insets.top }}>
        <View className="flex-row items-center px-5 pt-3 pb-2">
          <TouchableOpacity onPress={() => router.back()} className="w-10 h-10 rounded-full bg-card items-center justify-center">
            <Ionicons name="chevron-back" size={22} color={colors.ink} />
          </TouchableOpacity>
          <Text className="text-ink text-lg font-bold ml-3">Withdraw</Text>
        </View>

        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32 }}>
          <View className="rounded-2xl p-4 mt-2" style={{ backgroundColor: colors.card }}>
            <Text className="text-muted text-sm">Available balance</Text>
            <Text className="text-ink text-3xl font-extrabold mt-1">₦{balance.toLocaleString()}</Text>
          </View>

          <Text className="text-muted text-sm font-semibold mt-6 mb-2">Bank</Text>
          <TouchableOpacity
            onPress={() => setShowBanks(true)}
            className="flex-row items-center justify-between rounded-2xl px-4 py-3.5"
            style={{ backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}
          >
            <Text style={{ color: bankCode ? colors.ink : colors.muted }}>
              {bankName ?? 'Choose a bank'}
            </Text>
            <Ionicons name="chevron-down" size={20} color={colors.muted} />
          </TouchableOpacity>

          <Text className="text-muted text-sm font-semibold mt-5 mb-2">Account number</Text>
          <TextInput
            value={accountNumber}
            onChangeText={(t) => setAccountNumber(t.replace(/\D/g, ''))}
            keyboardType="number-pad"
            maxLength={10}
            placeholder="0123456789"
            placeholderTextColor={colors.muted}
            className="rounded-2xl px-4 py-3.5 text-ink"
            style={{ backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}
          />

          <Text className="text-muted text-sm font-semibold mt-5 mb-2">Amount</Text>
          <View className="flex-row items-center rounded-2xl px-4 py-3.5" style={{ backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}>
            <Text className="text-muted text-lg font-bold mr-1">₦</Text>
            <TextInput
              value={amount}
              onChangeText={(t) => setAmount(t.replace(/[^\d.]/g, ''))}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor={colors.muted}
              className="flex-1 text-ink text-lg font-bold"
            />
            <TouchableOpacity onPress={() => setAmount(String(balance))} className="rounded-full px-3 py-1" style={{ backgroundColor: 'rgba(107,91,149,0.25)' }}>
              <Text style={{ color: colors.brandLight, fontWeight: '700', fontSize: 12 }}>MAX</Text>
            </TouchableOpacity>
          </View>
          <Text className="text-muted text-xs mt-2">Minimum ₦100</Text>

          {error && <Text style={{ color: '#FF6B6B' }} className="text-sm mt-4">{error}</Text>}

          <TouchableOpacity
            onPress={submit}
            disabled={!valid || loading}
            className="rounded-full py-4 items-center mt-6"
            style={{ backgroundColor: colors.brand, opacity: valid && !loading ? 1 : 0.5 }}
          >
            <Text className="text-white font-bold text-base">{loading ? 'Processing…' : 'Withdraw'}</Text>
          </TouchableOpacity>
        </ScrollView>

        <Modal visible={showBanks} transparent animationType="slide" onRequestClose={() => setShowBanks(false)}>
          <TouchableOpacity className="flex-1 justify-end" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }} activeOpacity={1} onPress={() => setShowBanks(false)}>
            <View className="bg-surface rounded-t-3xl" style={{ maxHeight: '70%', paddingBottom: insets.bottom + 8 }}>
              <Text className="text-ink text-lg font-bold p-5">Select bank</Text>
              <ScrollView>
                {NIGERIAN_BANKS.map((bank) => (
                  <TouchableOpacity
                    key={bank.code}
                    onPress={() => {
                      setBankCode(bank.code);
                      setShowBanks(false);
                    }}
                    className="flex-row items-center justify-between px-5 py-3.5"
                    style={{ borderTopWidth: 1, borderTopColor: colors.border }}
                  >
                    <Text className="text-ink">{bank.name}</Text>
                    {bankCode === bank.code && <Ionicons name="checkmark" size={20} color={colors.positive} />}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </TouchableOpacity>
        </Modal>
      </View>
    </KeyboardAvoidingView>
  );
}
