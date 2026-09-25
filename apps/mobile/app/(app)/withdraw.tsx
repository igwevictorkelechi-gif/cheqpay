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
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { NIGERIAN_BANKS } from '@cheqpay/shared';
import { colors } from '@/components/brand';
import { SuccessAnimation } from '@/components/Lottie';
import { api, ApiError, type Bank, type Beneficiary } from '@/services/api';
import { useTransactionPin, PIN_CANCELLED } from '@/components/TransactionPinProvider';
import { naira, useLimits, withdrawalBreakdown } from '@/lib/fees';

// Amount -> choose/add a verified own-name beneficiary -> payout -> done.
// Payouts can only go to a bank account in the user's own name (verified at
// save time), matching the web flow.
type Stage = 'amount' | 'accounts' | 'add' | 'done';

export default function WithdrawScreen() {
  const insets = useSafeAreaInsets();
  const [stage, setStage] = useState<Stage>('amount');
  const [balance, setBalance] = useState(0);
  // The exact balance string from the server ("123456.78"), so MAX never loses a
  // kobo to floating-point rounding.
  const [balanceExact, setBalanceExact] = useState('0');
  const [amount, setAmount] = useState('');
  const limits = useLimits();
  // The summary shown before the PIN: amount, fee, what arrives.
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>([]);
  const [banks, setBanks] = useState<Bank[]>(NIGERIAN_BANKS as Bank[]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadingAccts, setLoadingAccts] = useState(false);

  // Add-beneficiary form
  const [bankCode, setBankCode] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [resolvedName, setResolvedName] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showBanks, setShowBanks] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        await api.ensureProvisioned();
        const { balances } = await api.getBalances();
        const exact = balances.find((b) => b.asset === 'NGN')?.availableFormatted ?? '0';
        setBalanceExact(exact);
        setBalance(Number(exact));
      } catch {
        /* ignore */
      }
    })();
  }, []);

  const amt = parseFloat(amount || '0') || 0;
  const feeNgn = limits?.fees.withdrawalFeeNgn ?? 0;
  const minNgn = limits?.withdrawal.minNgn ?? 0;
  // The fee comes out of the amount: balance drops by `amt`, the bank gets the rest.
  const breakdown = withdrawalBreakdown(amt, feeNgn);
  const amountProblem =
    amt <= 0
      ? null
      : amt > balance
        ? 'Amount exceeds your available balance.'
        : minNgn > 0 && amt < minNgn
          ? `The smallest withdrawal is ${naira(minNgn)}.`
          : !breakdown.ok
            ? `That doesn't cover the ${naira(feeNgn)} fee.`
            : null;
  const amountValid = amt > 0 && !amountProblem && limits !== null;
  /** What we send: the exact typed amount, at most two decimals. */
  const amountToSend = /^\d+(\.\d{1,2})?$/.test(amount) ? amount : amt.toFixed(2);
  const bankName = banks.find((b) => b.code === bankCode)?.name;
  const canResolve = bankCode !== '' && /^\d{10}$/.test(accountNumber) && !resolving;
  const selected = beneficiaries.find((b) => b.id === selectedId) ?? null;

  async function goToAccounts() {
    setError(null);
    if (amountProblem) return setError(amountProblem);
    setStage('accounts');
    setLoadingAccts(true);
    try {
      const [{ beneficiaries }, banksRes] = await Promise.all([
        api.getBeneficiaries(),
        api.getBanks().catch(() => ({ banks: [] as Bank[] })),
      ]);
      setBeneficiaries(beneficiaries);
      if (banksRes.banks.length) setBanks(banksRes.banks);
      setSelectedId(beneficiaries[0]?.id ?? null);
      if (beneficiaries.length === 0) setStage('add');
    } catch {
      setStage('add');
    } finally {
      setLoadingAccts(false);
    }
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

  async function saveAccount() {
    setError(null);
    setSaving(true);
    try {
      const { beneficiary } = await api.addBeneficiary({
        bankCode,
        bankName: bankName ?? '',
        accountNumber,
      });
      setBeneficiaries((prev) => [beneficiary, ...prev.filter((b) => b.id !== beneficiary.id)]);
      setSelectedId(beneficiary.id);
      setBankCode('');
      setAccountNumber('');
      setResolvedName(null);
      setStage('accounts');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Couldn’t save this account. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  async function removeAccount(id: string) {
    await api.deleteBeneficiary(id).catch(() => undefined);
    setBeneficiaries((prev) => prev.filter((b) => b.id !== id));
    if (selectedId === id) setSelectedId(null);
  }

  const { authorize } = useTransactionPin();

  async function payout() {
    if (!selected) return;
    setConfirming(false);
    setError(null);
    setLoading(true);
    try {
      await authorize(
        (pin) =>
          api.createNgnWithdrawal(
            {
              amount: amountToSend,
              bankCode: selected.bankCode,
              accountNumber: selected.accountNumber,
            },
            pin,
          ),
        {
          title: 'Confirm this withdrawal',
          detail: `${naira(breakdown.receive)} to ${selected.accountName} · ${selected.bankName}${
            breakdown.fee > 0 ? ` (${naira(breakdown.fee)} fee)` : ''
          }.`,
        },
      );
      setStage('done');
    } catch (e) {
      if (e instanceof Error && e.message === PIN_CANCELLED) return;
      setError(e instanceof ApiError ? e.message : 'Withdrawal failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  function Header({ title, onBack }: { title: string; onBack: () => void }) {
    return (
      <View className="flex-row items-center px-5 pt-3 pb-2">
        <TouchableOpacity onPress={onBack} className="w-10 h-10 rounded-full bg-card dark:bg-card-dark items-center justify-center">
          <Ionicons name="chevron-back" size={22} color={colors.ink} />
        </TouchableOpacity>
        <Text className="text-ink dark:text-ink-dark text-lg font-bold ml-3">{title}</Text>
      </View>
    );
  }

  if (stage === 'done') {
    return (
      <View className="flex-1 px-5 items-center" style={{ backgroundColor: colors.surface, paddingTop: insets.top + 40 }}>
        <SuccessAnimation />
        <Text className="text-ink dark:text-ink-dark text-2xl font-extrabold mt-6">Withdrawal submitted</Text>
        <Text className="text-muted dark:text-muted-dark text-sm mt-2 text-center">
          {naira(breakdown.receive)} is on its way to {selected?.accountName} · {selected?.bankName}.
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
        {stage === 'amount' && (
          <>
            <Header title="Withdraw" onBack={() => router.back()} />
            <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32 }}>
              <View className="rounded-2xl p-4 mt-2" style={{ backgroundColor: colors.card }}>
                <Text className="text-muted dark:text-muted-dark text-sm">Available balance</Text>
                <Text className="text-ink dark:text-ink-dark text-3xl font-extrabold mt-1">{naira(balance)}</Text>
              </View>

              <Text className="text-muted dark:text-muted-dark text-sm font-semibold mt-6 mb-2">Amount</Text>
              <View className="flex-row items-center rounded-2xl px-4 py-3.5" style={{ backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}>
                <Text className="text-muted dark:text-muted-dark text-lg font-bold mr-1">₦</Text>
                <TextInput
                  value={amount}
                  onChangeText={(t) => {
                    // Digits and one decimal point, at most two places (kobo).
                    const [w, ...rest] = t.replace(/[^\d.]/g, '').split('.');
                    setAmount(rest.length ? `${w}.${rest.join('').slice(0, 2)}` : w);
                  }}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  placeholderTextColor={colors.muted}
                  className="flex-1 text-ink dark:text-ink-dark text-lg font-bold"
                />
                <TouchableOpacity onPress={() => setAmount(balanceExact)} className="rounded-full px-3 py-1" style={{ backgroundColor: 'rgba(107,91,149,0.25)' }}>
                  <Text style={{ color: colors.brandLight, fontWeight: '700', fontSize: 12 }}>MAX</Text>
                </TouchableOpacity>
              </View>
              <Text className="text-muted dark:text-muted-dark text-xs mt-2">
                {limits === null
                  ? '…'
                  : `${feeNgn > 0 ? `${naira(feeNgn)} fee` : 'No fee'}${minNgn > 0 ? ` · Minimum ${naira(minNgn)}` : ''}`}
              </Text>

              {/* What they'll actually get — shown as they type, not after. */}
              {amt > 0 && breakdown.ok && limits !== null && (
                <View className="rounded-2xl p-4 mt-4" style={{ borderWidth: 1, borderColor: colors.border, gap: 8 }}>
                  <View className="flex-row justify-between">
                    <Text className="text-muted dark:text-muted-dark text-sm">Fee</Text>
                    <Text className="text-muted dark:text-muted-dark text-sm">
                      {feeNgn > 0 ? `−${naira(breakdown.fee)}` : 'Free'}
                    </Text>
                  </View>
                  <View className="flex-row justify-between">
                    <Text className="text-ink dark:text-ink-dark text-sm font-bold">You'll receive</Text>
                    <Text className="text-ink dark:text-ink-dark text-sm font-bold">{naira(breakdown.receive)}</Text>
                  </View>
                </View>
              )}

              {error && <Text style={{ color: '#FF6B6B' }} className="text-sm mt-4">{error}</Text>}

              <TouchableOpacity
                onPress={goToAccounts}
                disabled={!amountValid}
                className="rounded-full py-4 items-center mt-6"
                style={{ backgroundColor: colors.brand, opacity: amountValid ? 1 : 0.5 }}
              >
                <Text className="text-white font-bold text-base">Continue</Text>
              </TouchableOpacity>
            </ScrollView>
          </>
        )}

        {stage === 'accounts' && (
          <>
            <Header title="Choose account" onBack={() => setStage('amount')} />
            <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32 }}>
              <Text className="text-muted dark:text-muted-dark text-sm mt-1">
                Withdrawing <Text className="text-ink dark:text-ink-dark font-bold">{naira(amt)}</Text>
                {breakdown.ok ? (
                  <> · you'll receive <Text className="text-ink dark:text-ink-dark font-bold">{naira(breakdown.receive)}</Text></>
                ) : null}
              </Text>

              {loadingAccts ? (
                <ActivityIndicator color={colors.muted} style={{ marginTop: 40 }} />
              ) : (
                <>
                  <View className="mt-5" style={{ gap: 12 }}>
                    {beneficiaries.map((b) => (
                      <TouchableOpacity
                        key={b.id}
                        onPress={() => setSelectedId(b.id)}
                        className="flex-row items-center rounded-2xl p-4"
                        style={{
                          backgroundColor: colors.card,
                          borderWidth: 1,
                          borderColor: selectedId === b.id ? colors.brand : colors.border,
                        }}
                      >
                        <View className="w-11 h-11 rounded-full items-center justify-center" style={{ backgroundColor: colors.surfaceSoft }}>
                          <Ionicons name="business" size={20} color={colors.ink} />
                        </View>
                        <View className="flex-1 ml-3">
                          <Text className="text-ink dark:text-ink-dark font-bold" numberOfLines={1}>{b.accountName}</Text>
                          <Text className="text-muted dark:text-muted-dark text-sm" numberOfLines={1}>{b.bankName} · {b.accountNumber}</Text>
                        </View>
                        {selectedId === b.id ? (
                          <Ionicons name="checkmark-circle" size={22} color={colors.brand} />
                        ) : (
                          <TouchableOpacity onPress={() => removeAccount(b.id)} hitSlop={10}>
                            <Ionicons name="trash-outline" size={18} color={colors.muted} />
                          </TouchableOpacity>
                        )}
                      </TouchableOpacity>
                    ))}
                  </View>

                  <TouchableOpacity
                    onPress={() => { setError(null); setStage('add'); }}
                    className="flex-row items-center justify-center rounded-2xl py-4 mt-4"
                    style={{ borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed' }}
                  >
                    <Ionicons name="add" size={20} color={colors.brandLight} />
                    <Text style={{ color: colors.brandLight }} className="font-bold ml-1">Add a new account</Text>
                  </TouchableOpacity>

                  {error && <Text style={{ color: '#FF6B6B' }} className="text-sm mt-4">{error}</Text>}

                  <TouchableOpacity
                    onPress={() => setConfirming(true)}
                    disabled={!selected || loading}
                    className="rounded-full py-4 items-center mt-6"
                    style={{ backgroundColor: colors.brand, opacity: selected && !loading ? 1 : 0.5 }}
                  >
                    <Text className="text-white font-bold text-base">
                      {loading ? 'Processing…' : `Withdraw ${naira(amt)}`}
                    </Text>
                  </TouchableOpacity>
                </>
              )}
            </ScrollView>
          </>
        )}

        {stage === 'add' && (
          <>
            <Header title="Add account" onBack={() => setStage(beneficiaries.length ? 'accounts' : 'amount')} />
            <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32 }}>
              <Text className="text-muted dark:text-muted-dark text-sm font-semibold mt-4 mb-2">Bank</Text>
              <TouchableOpacity
                onPress={() => setShowBanks(true)}
                className="flex-row items-center justify-between rounded-2xl px-4 py-3.5"
                style={{ backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}
              >
                <Text style={{ color: bankCode ? colors.ink : colors.muted }}>{bankName ?? 'Choose a bank'}</Text>
                <Ionicons name="chevron-down" size={20} color={colors.muted} />
              </TouchableOpacity>

              <Text className="text-muted dark:text-muted-dark text-sm font-semibold mt-5 mb-2">Account number</Text>
              <TextInput
                value={accountNumber}
                onChangeText={(t) => { setAccountNumber(t.replace(/\D/g, '').slice(0, 10)); setResolvedName(null); }}
                keyboardType="number-pad"
                maxLength={10}
                placeholder="10-digit NUBAN"
                placeholderTextColor={colors.muted}
                className="rounded-2xl px-4 py-3.5 text-ink dark:text-ink-dark"
                style={{ backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}
              />

              {resolvedName ? (
                <View className="flex-row items-center rounded-2xl p-4 mt-4" style={{ backgroundColor: 'rgba(52,199,89,0.1)', borderWidth: 1, borderColor: 'rgba(52,199,89,0.3)' }}>
                  <Ionicons name="shield-checkmark" size={20} color={colors.positive} />
                  <Text className="text-ink dark:text-ink-dark font-bold ml-2">{resolvedName}</Text>
                </View>
              ) : (
                <TouchableOpacity
                  onPress={verify}
                  disabled={!canResolve}
                  className="rounded-2xl py-3.5 items-center mt-4"
                  style={{ backgroundColor: colors.card, opacity: canResolve ? 1 : 0.4 }}
                >
                  <Text className="text-ink dark:text-ink-dark font-bold">{resolving ? 'Verifying…' : 'Verify account'}</Text>
                </TouchableOpacity>
              )}

              {error && <Text style={{ color: '#FF6B6B' }} className="text-sm mt-4">{error}</Text>}

              <View className="flex-row items-start mt-4" style={{ gap: 6 }}>
                <Ionicons name="shield-checkmark" size={16} color={colors.brandLight} style={{ marginTop: 2 }} />
                <Text className="text-muted dark:text-muted-dark text-xs flex-1">
                  For your security, you can only withdraw to a bank account in your own name.
                </Text>
              </View>

              {resolvedName && (
                <TouchableOpacity
                  onPress={saveAccount}
                  disabled={saving}
                  className="rounded-full py-4 items-center mt-6"
                  style={{ backgroundColor: colors.brand, opacity: saving ? 0.5 : 1 }}
                >
                  <Text className="text-white font-bold text-base">{saving ? 'Saving…' : 'Save account'}</Text>
                </TouchableOpacity>
              )}
            </ScrollView>
          </>
        )}

        <Modal visible={confirming && !!selected} transparent animationType="slide" onRequestClose={() => setConfirming(false)}>
          <TouchableOpacity className="flex-1 justify-end" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }} activeOpacity={1} onPress={() => setConfirming(false)}>
            <TouchableOpacity activeOpacity={1} className="bg-surface dark:bg-surface-dark rounded-t-3xl p-5" style={{ paddingBottom: insets.bottom + 16 }}>
              <Text className="text-ink dark:text-ink-dark text-xl font-extrabold">Confirm withdrawal</Text>

              <View className="rounded-2xl p-4 mt-5" style={{ backgroundColor: colors.card, gap: 12 }}>
                <View className="flex-row justify-between">
                  <Text className="text-muted dark:text-muted-dark">Withdrawing</Text>
                  <Text className="text-ink dark:text-ink-dark font-semibold">{naira(breakdown.amount)}</Text>
                </View>
                <View className="flex-row justify-between">
                  <Text className="text-muted dark:text-muted-dark">Fee</Text>
                  <Text className="text-ink dark:text-ink-dark font-semibold">
                    {breakdown.fee > 0 ? `−${naira(breakdown.fee)}` : 'Free'}
                  </Text>
                </View>
                <View className="flex-row justify-between pt-3" style={{ borderTopWidth: 1, borderTopColor: colors.border }}>
                  <Text className="text-ink dark:text-ink-dark text-base font-bold">You'll receive</Text>
                  <Text className="text-ink dark:text-ink-dark text-base font-extrabold">{naira(breakdown.receive)}</Text>
                </View>
              </View>

              {selected && (
                <View className="flex-row items-center rounded-2xl p-4 mt-3" style={{ backgroundColor: colors.card }}>
                  <View className="w-10 h-10 rounded-full items-center justify-center" style={{ backgroundColor: colors.surfaceSoft }}>
                    <Ionicons name="business" size={18} color={colors.ink} />
                  </View>
                  <View className="flex-1 ml-3">
                    <Text className="text-ink dark:text-ink-dark font-bold" numberOfLines={1}>{selected.accountName}</Text>
                    <Text className="text-muted dark:text-muted-dark text-sm" numberOfLines={1}>{selected.bankName} · {selected.accountNumber}</Text>
                  </View>
                </View>
              )}

              <Text className="text-muted dark:text-muted-dark text-xs mt-3">
                Your balance goes down by {naira(breakdown.amount)}. Check the account — a payout can't always be recovered once sent.
              </Text>

              <View className="flex-row mt-5" style={{ gap: 12 }}>
                <TouchableOpacity onPress={() => setConfirming(false)} className="flex-1 rounded-full py-4 items-center" style={{ backgroundColor: colors.card }}>
                  <Text className="text-ink dark:text-ink-dark font-bold">Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={payout} className="flex-1 rounded-full py-4 items-center" style={{ backgroundColor: colors.brand }}>
                  <Text className="text-white font-bold">Confirm</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>

        <Modal visible={showBanks} transparent animationType="slide" onRequestClose={() => setShowBanks(false)}>
          <TouchableOpacity className="flex-1 justify-end" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }} activeOpacity={1} onPress={() => setShowBanks(false)}>
            <View className="bg-surface dark:bg-surface-dark rounded-t-3xl" style={{ maxHeight: '70%', paddingBottom: insets.bottom + 8 }}>
              <Text className="text-ink dark:text-ink-dark text-lg font-bold p-5">Select bank</Text>
              <ScrollView>
                {banks.map((bank) => (
                  <TouchableOpacity
                    key={bank.code}
                    onPress={() => { setBankCode(bank.code); setResolvedName(null); setShowBanks(false); }}
                    className="flex-row items-center justify-between px-5 py-3.5"
                    style={{ borderTopWidth: 1, borderTopColor: colors.border }}
                  >
                    <Text className="text-ink dark:text-ink-dark">{bank.name}</Text>
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
