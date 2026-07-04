import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useAuthStore } from '@/store';
import { colors } from '@/components/brand';
import { api, ApiError } from '@/services/api';

type State = 'loading' | 'form' | 'pending' | 'approved';

export default function KYCScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();

  const [state, setState] = useState<State>('loading');
  const [tier, setTier] = useState(0);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [bvn, setBvn] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const parts = (user?.full_name ?? '').trim().split(/\s+/);
    if (parts[0]) setFirstName((v) => v || parts[0]);
    if (parts.length > 1) setLastName((v) => v || parts.slice(1).join(' '));
  }, [user?.full_name]);

  useEffect(() => {
    (async () => {
      try {
        await api.ensureProvisioned();
        const { kycTier, records } = await api.getKyc();
        setTier(kycTier);
        if (kycTier >= 2) setState('approved');
        else if (records.some((r) => r.status === 'PENDING')) setState('pending');
        else setState('form');
      } catch {
        setState('form');
      }
    })();
  }, []);

  const bvnValid = bvn === '' || /^\d{11}$/.test(bvn);
  const canSubmit =
    firstName.trim().length >= 2 && lastName.trim().length >= 2 && bvnValid && !submitting;

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await api.submitKyc({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        bvn: bvn.trim() || undefined,
      });
      setTier(res.tier);
      setState(res.autoVerified ? 'approved' : 'pending');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not submit. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const Header = (
    <View className="flex-row items-center px-5 pt-3 pb-2">
      <TouchableOpacity onPress={() => router.back()} className="w-10 h-10 rounded-full bg-card items-center justify-center">
        <Ionicons name="chevron-back" size={22} color={colors.ink} />
      </TouchableOpacity>
    </View>
  );

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1">
      <View className="flex-1" style={{ backgroundColor: colors.surface, paddingTop: insets.top }}>
        {Header}
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
          {state === 'loading' && <ActivityIndicator color={colors.brand} style={{ marginTop: 40 }} />}

          {state === 'approved' && (
            <View className="items-center pt-8">
              <Ionicons name="checkmark-circle" size={80} color={colors.positive} />
              <Text className="text-ink text-2xl font-extrabold mt-6">You&apos;re verified</Text>
              <Text className="text-muted text-sm mt-2 text-center">
                Your identity is confirmed (Tier {tier}). Higher limits and crypto withdrawals are
                unlocked.
              </Text>
              <TouchableOpacity onPress={() => router.replace('/(app)/home')} className="rounded-2xl py-4 items-center mt-8 w-full" style={{ backgroundColor: colors.brand }}>
                <Text className="text-white font-bold text-base">Done</Text>
              </TouchableOpacity>
            </View>
          )}

          {state === 'pending' && (
            <View className="items-center pt-8">
              <View className="w-20 h-20 rounded-full items-center justify-center" style={{ backgroundColor: 'rgba(245,166,35,0.15)' }}>
                <Ionicons name="time-outline" size={40} color="#F5A623" />
              </View>
              <Text className="text-ink text-2xl font-extrabold mt-6">Under review</Text>
              <Text className="text-muted text-sm mt-2 text-center">
                We couldn&apos;t verify you automatically, so our team is reviewing your details.
                You&apos;ll be upgraded as soon as it&apos;s approved — usually within a few hours.
              </Text>
              <TouchableOpacity onPress={() => router.replace('/(app)/home')} className="rounded-2xl py-4 items-center mt-8 w-full" style={{ backgroundColor: colors.card }}>
                <Text className="text-ink font-bold text-base">Back home</Text>
              </TouchableOpacity>
            </View>
          )}

          {state === 'form' && (
            <>
              <View className="flex-row items-center mt-4">
                <View className="w-11 h-11 rounded-2xl items-center justify-center" style={{ backgroundColor: 'rgba(107,91,149,0.2)' }}>
                  <Ionicons name="shield-checkmark" size={24} color={colors.brandLight} />
                </View>
                <Text className="text-ink text-2xl font-extrabold ml-3">Verify your identity</Text>
              </View>
              <Text className="text-muted text-sm mt-2">
                Confirm your details to raise your limits and unlock crypto withdrawals. With a valid
                BVN you&apos;re verified instantly.
              </Text>

              <View className="mt-6" style={{ gap: 16 }}>
                <Input label="First name" value={firstName} onChangeText={setFirstName} placeholder="First name" />
                <Input label="Last name" value={lastName} onChangeText={setLastName} placeholder="Last name" />
                <View>
                  <Text className="text-muted text-sm font-semibold mb-1.5">
                    BVN (for instant verification)
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
                    Without a BVN we&apos;ll review your submission manually.
                  </Text>
                </View>
              </View>

              {error && <Text style={{ color: '#FF6B6B' }} className="text-sm mt-4">{error}</Text>}

              <TouchableOpacity
                onPress={submit}
                disabled={!canSubmit}
                className="rounded-2xl py-4 items-center mt-6 flex-row justify-center"
                style={{ backgroundColor: colors.brand, opacity: canSubmit ? 1 : 0.4 }}
              >
                {submitting && <ActivityIndicator color="#fff" style={{ marginRight: 8 }} />}
                <Text className="text-white font-bold text-base">
                  {submitting ? 'Verifying…' : 'Submit for verification'}
                </Text>
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

function Input({
  label,
  value,
  onChangeText,
  placeholder,
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder: string;
}) {
  return (
    <View>
      <Text className="text-muted text-sm font-semibold mb-1.5">{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        className="rounded-2xl px-4 py-3.5 text-ink"
        style={{ backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}
      />
    </View>
  );
}
