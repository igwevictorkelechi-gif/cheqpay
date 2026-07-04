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
  Share,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { useAuthStore } from '@/store';
import { colors } from '@/components/brand';
import { api, ApiError, type VirtualAccount } from '@/services/api';

export default function VirtualAccountScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();

  const [loading, setLoading] = useState(true);
  const [account, setAccount] = useState<VirtualAccount | null>(null);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [bvn, setBvn] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const parts = (user?.full_name ?? '').trim().split(/\s+/);
    if (parts[0]) setFirstName((v) => v || parts[0]);
    if (parts.length > 1) setLastName((v) => v || parts.slice(1).join(' '));
  }, [user?.full_name]);

  useEffect(() => {
    (async () => {
      try {
        await api.ensureProvisioned();
        const { virtualAccount } = await api.getVirtualAccount();
        setAccount(virtualAccount);
      } catch {
        /* ignore — show the form */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const bvnValid = bvn === '' || /^\d{11}$/.test(bvn);
  const canSubmit =
    firstName.trim().length >= 2 && lastName.trim().length >= 2 && bvnValid && !submitting;

  async function submit() {
    setError(null);
    if (bvn !== '' && !/^\d{11}$/.test(bvn)) {
      setError('BVN must be exactly 11 digits.');
      return;
    }
    setSubmitting(true);
    try {
      const { virtualAccount } = await api.createVirtualAccount({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: phone.trim() || undefined,
        bvn: bvn.trim() || undefined,
      });
      setAccount(virtualAccount);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not create your account. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function copy(text: string) {
    await Clipboard.setStringAsync(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  const Header = (
    <View className="flex-row items-center px-5 pt-3 pb-2">
      <TouchableOpacity onPress={() => router.back()} className="w-10 h-10 rounded-full bg-card items-center justify-center">
        <Ionicons name="chevron-back" size={22} color={colors.ink} />
      </TouchableOpacity>
    </View>
  );

  if (loading) {
    return (
      <View className="flex-1" style={{ backgroundColor: colors.surface, paddingTop: insets.top }}>
        {Header}
        <ActivityIndicator color={colors.brand} style={{ marginTop: 40 }} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1">
      <View className="flex-1" style={{ backgroundColor: colors.surface, paddingTop: insets.top }}>
        {Header}
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
          {account ? (
            <>
              <View className="items-center mt-4">
                <View className="w-14 h-14 rounded-2xl items-center justify-center" style={{ backgroundColor: 'rgba(107,91,149,0.2)' }}>
                  <Ionicons name="business" size={28} color={colors.brandLight} />
                </View>
                <Text className="text-ink text-2xl font-extrabold mt-4">Your account is ready</Text>
                <Text className="text-muted text-sm mt-1 text-center">
                  Send money to this account from any Nigerian bank to fund your wallet instantly.
                </Text>
              </View>

              <View className="rounded-3xl p-5 mt-6" style={{ backgroundColor: colors.card }}>
                <Field label="Bank name" value={account.bankName} />
                <View className="my-3 h-px" style={{ backgroundColor: colors.border }} />
                <Text className="text-muted text-xs font-semibold uppercase">Account number</Text>
                <View className="flex-row items-center justify-between mt-1">
                  <Text className="text-ink text-2xl font-extrabold" style={{ letterSpacing: 1 }}>
                    {account.accountNumber}
                  </Text>
                  <TouchableOpacity
                    onPress={() => copy(account.accountNumber)}
                    className="flex-row items-center rounded-full px-3 py-2"
                    style={{ backgroundColor: colors.surface }}
                  >
                    <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={16} color={copied ? colors.positive : colors.ink} />
                    <Text className="text-ink font-bold ml-1.5 text-sm">{copied ? 'Copied' : 'Copy'}</Text>
                  </TouchableOpacity>
                </View>
                <View className="my-3 h-px" style={{ backgroundColor: colors.border }} />
                <Field label="Account type" value={account.permanent ? 'Permanent (dedicated)' : 'Temporary'} />
              </View>

              {!account.permanent && (
                <View className="rounded-2xl p-4 mt-5 flex-row" style={{ backgroundColor: 'rgba(245,166,35,0.1)', borderWidth: 1, borderColor: 'rgba(245,166,35,0.3)' }}>
                  <Ionicons name="information-circle-outline" size={20} color="#F5A623" />
                  <Text className="text-xs ml-3 flex-1" style={{ color: '#F5C97B', lineHeight: 18 }}>
                    This is a temporary account. Add your BVN to upgrade to a permanent, dedicated
                    account number you can reuse for every deposit.
                  </Text>
                </View>
              )}

              <View className="flex-row mt-6" style={{ gap: 12 }}>
                <TouchableOpacity
                  onPress={() => Share.share({ message: `${account.bankName} · ${account.accountNumber}` })}
                  className="flex-1 rounded-full py-4 items-center flex-row justify-center"
                  style={{ backgroundColor: colors.card }}
                >
                  <Ionicons name="share-social-outline" size={18} color={colors.ink} />
                  <Text className="text-ink font-bold ml-2">Share</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => router.replace('/(app)/home')} className="flex-1 rounded-full py-4 items-center" style={{ backgroundColor: colors.brand }}>
                  <Text className="text-white font-bold">Done</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <>
              <Text className="text-ink text-3xl font-extrabold mt-4">Set up your account</Text>
              <Text className="text-muted text-sm mt-2">
                Create your own CheqPay account number to receive Naira deposits from any bank. We
                need a few details to open it.
              </Text>

              <View className="mt-6" style={{ gap: 16 }}>
                <Input label="First name" value={firstName} onChangeText={setFirstName} placeholder="First name" />
                <Input label="Last name" value={lastName} onChangeText={setLastName} placeholder="Last name" />
                <Input
                  label="Phone number (optional)"
                  value={phone}
                  onChangeText={(t) => setPhone(t.replace(/[^\d+]/g, ''))}
                  placeholder="0801 234 5678"
                  keyboardType="phone-pad"
                />
                <View>
                  <Text className="text-muted text-sm font-semibold mb-1.5">
                    BVN (optional — for a permanent account)
                  </Text>
                  <TextInput
                    value={bvn}
                    onChangeText={(t) => setBvn(t.replace(/\D/g, '').slice(0, 11))}
                    keyboardType="number-pad"
                    placeholder="11-digit BVN"
                    placeholderTextColor={colors.muted}
                    className="rounded-2xl px-4 py-3.5 text-ink"
                    style={{ backgroundColor: colors.card, borderWidth: 1, borderColor: bvnValid ? colors.border : '#EF4444' }}
                  />
                  <Text className="text-muted text-xs mt-1.5">
                    With a BVN you get a permanent, dedicated account number. Without it, we open a
                    temporary one you can upgrade later.
                  </Text>
                </View>
              </View>

              {error && <Text style={{ color: '#FF6B6B' }} className="text-sm mt-4">{error}</Text>}

              <View className="flex-row items-center mt-5">
                <Ionicons name="shield-checkmark-outline" size={16} color={colors.brandLight} />
                <Text className="text-muted text-xs ml-2 flex-1">
                  Your details are sent securely to our licensed payment partner to open the account.
                </Text>
              </View>

              <TouchableOpacity
                onPress={submit}
                disabled={!canSubmit}
                className="rounded-2xl py-4 items-center mt-6 flex-row justify-center"
                style={{ backgroundColor: colors.brand, opacity: canSubmit ? 1 : 0.4 }}
              >
                {submitting && <ActivityIndicator color="#fff" style={{ marginRight: 8 }} />}
                <Text className="text-white font-bold text-base">
                  {submitting ? 'Creating account…' : 'Create my account'}
                </Text>
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View>
      <Text className="text-muted text-xs font-semibold uppercase">{label}</Text>
      <Text className="text-ink text-base font-bold mt-1">{value}</Text>
    </View>
  );
}

function Input({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder: string;
  keyboardType?: 'phone-pad' | 'number-pad';
}) {
  return (
    <View>
      <Text className="text-muted text-sm font-semibold mb-1.5">{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        keyboardType={keyboardType}
        className="rounded-2xl px-4 py-3.5 text-ink"
        style={{ backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}
      />
    </View>
  );
}
