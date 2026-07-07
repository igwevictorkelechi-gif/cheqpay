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
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { NIGERIAN_BANKS } from '@cheqpay/shared';
import { colors } from '@/components/brand';
import { api, ApiError, type Bank, type Beneficiary } from '@/services/api';

// Standalone management of the bank accounts saved for Naira withdrawals.
type Mode = 'list' | 'add';

export default function BankAccountsScreen() {
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<Mode>('list');
  const [loading, setLoading] = useState(true);
  const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>([]);
  const [banks, setBanks] = useState<Bank[]>(NIGERIAN_BANKS as Bank[]);

  const [bankCode, setBankCode] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [resolvedName, setResolvedName] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showBanks, setShowBanks] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [{ beneficiaries }, banksRes] = await Promise.all([
          api.getBeneficiaries(),
          api.getBanks().catch(() => ({ banks: [] as Bank[] })),
        ]);
        setBeneficiaries(beneficiaries);
        if (banksRes.banks.length) setBanks(banksRes.banks);
      } catch {
        /* keep fallback */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const bankName = banks.find((b) => b.code === bankCode)?.name;
  const canResolve = bankCode !== '' && /^\d{10}$/.test(accountNumber) && !resolving;

  function resetForm() {
    setBankCode('');
    setAccountNumber('');
    setResolvedName(null);
    setError(null);
  }

  async function verify() {
    setError(null);
    setResolvedName(null);
    setResolving(true);
    try {
      const { accountName } = await api.resolveBankAccount({ accountNumber, bankCode });
      setResolvedName(accountName);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Couldn’t verify that account. Check the details.');
    } finally {
      setResolving(false);
    }
  }

  async function save() {
    setError(null);
    setSaving(true);
    try {
      const { beneficiary } = await api.addBeneficiary({ bankCode, bankName: bankName ?? '', accountNumber });
      setBeneficiaries((prev) => [beneficiary, ...prev.filter((b) => b.id !== beneficiary.id)]);
      resetForm();
      setMode('list');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Couldn’t save this account. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  function remove(id: string) {
    Alert.alert('Remove account', 'Remove this saved account?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          await api.deleteBeneficiary(id).catch(() => undefined);
          setBeneficiaries((prev) => prev.filter((b) => b.id !== id));
        },
      },
    ]);
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1">
      <View className="flex-1" style={{ backgroundColor: colors.surface, paddingTop: insets.top }}>
        <View className="flex-row items-center px-5 pt-3 pb-2">
          <TouchableOpacity
            onPress={() => (mode === 'add' ? (resetForm(), setMode('list')) : router.back())}
            className="w-10 h-10 rounded-full bg-card items-center justify-center"
          >
            <Ionicons name="chevron-back" size={22} color={colors.ink} />
          </TouchableOpacity>
          <Text className="text-ink text-lg font-bold ml-3">
            {mode === 'add' ? 'Add bank account' : 'Bank accounts'}
          </Text>
        </View>

        {loading ? (
          <ActivityIndicator color={colors.muted} style={{ marginTop: 40 }} />
        ) : mode === 'list' ? (
          <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 32 }}>
            <Text className="text-muted text-sm mt-1 mb-4">Accounts saved for your Naira withdrawals.</Text>

            {beneficiaries.length === 0 ? (
              <View className="items-center py-10">
                <View className="w-16 h-16 rounded-full items-center justify-center" style={{ backgroundColor: colors.card }}>
                  <Ionicons name="business" size={26} color={colors.muted} />
                </View>
                <Text className="text-ink font-bold mt-4">No bank accounts yet</Text>
                <Text className="text-muted text-sm mt-1 text-center px-6">
                  Add a bank account in your name to withdraw your Naira balance.
                </Text>
              </View>
            ) : (
              <View style={{ gap: 12 }}>
                {beneficiaries.map((b) => (
                  <View key={b.id} className="flex-row items-center bg-card rounded-2xl p-4" style={{ borderWidth: 1, borderColor: colors.border }}>
                    <View className="w-11 h-11 rounded-full items-center justify-center" style={{ backgroundColor: colors.surfaceSoft }}>
                      <Ionicons name="business" size={20} color={colors.ink} />
                    </View>
                    <View className="flex-1 ml-3">
                      <Text className="text-ink font-bold" numberOfLines={1}>{b.accountName}</Text>
                      <Text className="text-muted text-sm" numberOfLines={1}>{b.bankName} · {b.accountNumber}</Text>
                    </View>
                    <TouchableOpacity onPress={() => remove(b.id)} hitSlop={10} className="w-9 h-9 rounded-full items-center justify-center" style={{ backgroundColor: colors.surfaceSoft }}>
                      <Ionicons name="trash-outline" size={16} color={colors.muted} />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}

            <TouchableOpacity
              onPress={() => { setError(null); setMode('add'); }}
              className="flex-row items-center justify-center rounded-2xl py-4 mt-4"
              style={{ borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed' }}
            >
              <Ionicons name="add" size={20} color={colors.brandLight} />
              <Text style={{ color: colors.brandLight }} className="font-bold ml-1">Add a new account</Text>
            </TouchableOpacity>

            <View className="flex-row items-start mt-5" style={{ gap: 6 }}>
              <Ionicons name="shield-checkmark" size={16} color={colors.brandLight} style={{ marginTop: 2 }} />
              <Text className="text-muted text-xs flex-1">
                For your security, you can only withdraw to a bank account in your own name.
              </Text>
            </View>
          </ScrollView>
        ) : (
          <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 32 }}>
            <Text className="text-muted text-sm font-semibold mt-4 mb-2">Bank</Text>
            <TouchableOpacity
              onPress={() => setShowBanks(true)}
              className="flex-row items-center justify-between rounded-2xl px-4 py-3.5"
              style={{ backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}
            >
              <Text style={{ color: bankCode ? colors.ink : colors.muted }}>{bankName ?? 'Choose a bank'}</Text>
              <Ionicons name="chevron-down" size={20} color={colors.muted} />
            </TouchableOpacity>

            <Text className="text-muted text-sm font-semibold mt-5 mb-2">Account number</Text>
            <TextInput
              value={accountNumber}
              onChangeText={(t) => { setAccountNumber(t.replace(/\D/g, '').slice(0, 10)); setResolvedName(null); }}
              keyboardType="number-pad"
              maxLength={10}
              placeholder="10-digit NUBAN"
              placeholderTextColor={colors.muted}
              className="rounded-2xl px-4 py-3.5 text-ink"
              style={{ backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}
            />

            {resolvedName ? (
              <View className="flex-row items-center rounded-2xl p-4 mt-4" style={{ backgroundColor: 'rgba(52,199,89,0.1)', borderWidth: 1, borderColor: 'rgba(52,199,89,0.3)' }}>
                <Ionicons name="shield-checkmark" size={20} color={colors.positive} />
                <Text className="text-ink font-bold ml-2">{resolvedName}</Text>
              </View>
            ) : (
              <TouchableOpacity
                onPress={verify}
                disabled={!canResolve}
                className="rounded-2xl py-3.5 items-center mt-4"
                style={{ backgroundColor: colors.card, opacity: canResolve ? 1 : 0.4 }}
              >
                <Text className="text-ink font-bold">{resolving ? 'Verifying…' : 'Verify account'}</Text>
              </TouchableOpacity>
            )}

            {error && <Text style={{ color: '#FF6B6B' }} className="text-sm mt-4">{error}</Text>}

            {resolvedName && (
              <TouchableOpacity
                onPress={save}
                disabled={saving}
                className="rounded-full py-4 items-center mt-6"
                style={{ backgroundColor: colors.brand, opacity: saving ? 0.5 : 1 }}
              >
                <Text className="text-white font-bold text-base">{saving ? 'Saving…' : 'Save account'}</Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        )}

        <Modal visible={showBanks} transparent animationType="slide" onRequestClose={() => setShowBanks(false)}>
          <TouchableOpacity className="flex-1 justify-end" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }} activeOpacity={1} onPress={() => setShowBanks(false)}>
            <View className="bg-surface rounded-t-3xl" style={{ maxHeight: '70%', paddingBottom: insets.bottom + 8 }}>
              <Text className="text-ink text-lg font-bold p-5">Select bank</Text>
              <ScrollView>
                {banks.map((bank) => (
                  <TouchableOpacity
                    key={bank.code}
                    onPress={() => { setBankCode(bank.code); setResolvedName(null); setShowBanks(false); }}
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
