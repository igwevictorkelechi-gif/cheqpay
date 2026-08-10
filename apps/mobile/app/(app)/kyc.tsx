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
import { router, useLocalSearchParams } from 'expo-router';
import { useAuthStore } from '@/store';
import { colors } from '@/components/brand';
import { api, ApiError } from '@/services/api';

type State = 'loading' | 'form' | 'pending' | 'approved';

export default function KYCScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  // Optional post-verification destination (e.g. the deposit flow sends the
  // user here to verify, then wants them back on the account page).
  const params = useLocalSearchParams<{ next?: string }>();
  const nextUrl =
    typeof params.next === 'string' && params.next.startsWith('/') ? params.next : null;
  const goNext = () => router.replace((nextUrl ?? '/(app)/home') as never);

  const [state, setState] = useState<State>('loading');
  const [tier, setTier] = useState(0);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [bvn, setBvn] = useState('');
  // Required to enroll the user with the payment provider, which is what a
  // deposit account and a crypto address both hang off. The form used to omit
  // them, so enrollment was skipped for every user who ever verified — they
  // passed KYC and still got no account number.
  const [phone, setPhone] = useState('');
  const [street, setStreet] = useState('');
  const [city, setCity] = useState('');
  const [addrState, setAddrState] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Already verified, but missing the details the provider needs. */
  const [needsDetails, setNeedsDetails] = useState(false);

  useEffect(() => {
    const parts = (user?.full_name ?? '').trim().split(/\s+/);
    if (parts[0]) setFirstName((v) => v || parts[0]);
    if (parts.length > 1) setLastName((v) => v || parts.slice(1).join(' '));
  }, [user?.full_name]);

  useEffect(() => {
    (async () => {
      try {
        await api.ensureProvisioned();
        const { kycTier, records, providerEnrolled, legalName } = await api.getKyc();
        setTier(kycTier);
        // Prefer the verified name: it is the one the provider checks against
        // the BVN, and the only one guaranteed to be present.
        if (legalName) {
          const p = legalName.trim().split(/\s+/);
          if (p[0]) setFirstName(p[0]);
          if (p.length > 1) setLastName(p.slice(1).join(' '));
        }
        // Verified but not enrolled means the account is only half open — no
        // deposit account, no crypto wallet. Show the form rather than a green
        // tick over an account that cannot receive money.
        if (kycTier >= 2 && providerEnrolled === false) {
          setNeedsDetails(true);
          setState('form');
        } else if (kycTier >= 2) setState('approved');
        else if (records.some((r) => r.status === 'PENDING')) setState('pending');
        else setState('form');
      } catch {
        setState('form');
      }
    })();
  }, []);

  const bvnValid = bvn === '' || /^\d{11}$/.test(bvn);
  // Accepts 08031234567, +2348031234567 and 2348031234567 — the server
  // normalizes to the provider's +234 / subscriber split.
  const phoneValid = phone === '' || /^(\+?234|0)?\d{10}$/.test(phone.replace(/[\s-]/g, ''));

  /**
   * Everything the provider needs to enroll a customer. Sent only when
   * complete — a partial address is rejected by the API's schema, which would
   * fail the whole KYC submission rather than just skipping enrollment.
   */
  const addressComplete =
    street.trim().length >= 3 &&
    city.trim().length >= 2 &&
    addrState.trim().length >= 2 &&
    postalCode.trim().length >= 3;

  const canSubmit =
    firstName.trim().length >= 2 &&
    lastName.trim().length >= 2 &&
    bvnValid &&
    phoneValid &&
    // When the ONLY reason the user is here is the missing details, letting
    // them submit without those details repeats the failure that sent them.
    (!needsDetails || (phone.trim() !== '' && addressComplete)) &&
    !submitting;

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await api.submitKyc({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        bvn: bvn.trim() || undefined,
        phone: phone.trim() || undefined,
        address: addressComplete
          ? {
              street: street.trim(),
              city: city.trim(),
              state: addrState.trim(),
              postalCode: postalCode.trim(),
            }
          : undefined,
      });
      setTier(res.tier);
      // An already-verified user completing their details won't retype the
      // BVN, so this reports autoVerified:false. Sending them to "Under
      // review" would tell a verified user their account is in doubt.
      setState(needsDetails || res.autoVerified ? 'approved' : 'pending');
      setNeedsDetails(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not submit. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const Header = (
    <View className="flex-row items-center px-5 pt-3 pb-2">
      <TouchableOpacity onPress={() => router.back()} className="w-10 h-10 rounded-full bg-card dark:bg-card-dark items-center justify-center">
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
              <Text className="text-ink dark:text-ink-dark text-2xl font-extrabold mt-6">You&apos;re verified</Text>
              <Text className="text-muted dark:text-muted-dark text-sm mt-2 text-center">
                Your identity is confirmed (Tier {tier}). Higher limits and crypto withdrawals are
                unlocked.
              </Text>
              <TouchableOpacity onPress={goNext} className="rounded-2xl py-4 items-center mt-8 w-full" style={{ backgroundColor: colors.brand }}>
                <Text className="text-white font-bold text-base">{nextUrl ? 'Continue to deposit' : 'Done'}</Text>
              </TouchableOpacity>
            </View>
          )}

          {state === 'pending' && (
            <View className="items-center pt-8">
              <View className="w-20 h-20 rounded-full items-center justify-center" style={{ backgroundColor: 'rgba(245,166,35,0.15)' }}>
                <Ionicons name="time-outline" size={40} color="#F5A623" />
              </View>
              <Text className="text-ink dark:text-ink-dark text-2xl font-extrabold mt-6">Under review</Text>
              <Text className="text-muted dark:text-muted-dark text-sm mt-2 text-center">
                We couldn&apos;t verify you automatically, so our team is reviewing your details.
                You&apos;ll be upgraded as soon as it&apos;s approved — usually within a few hours.
              </Text>
              <TouchableOpacity onPress={() => router.replace('/(app)/home')} className="rounded-2xl py-4 items-center mt-8 w-full" style={{ backgroundColor: colors.card }}>
                <Text className="text-ink dark:text-ink-dark font-bold text-base">Back home</Text>
              </TouchableOpacity>
            </View>
          )}

          {state === 'form' && (
            <>
              <View className="flex-row items-center mt-4">
                <View className="w-11 h-11 rounded-2xl items-center justify-center" style={{ backgroundColor: 'rgba(107,91,149,0.2)' }}>
                  <Ionicons name="shield-checkmark" size={24} color={colors.brandLight} />
                </View>
                <Text className="text-ink dark:text-ink-dark text-2xl font-extrabold ml-3 flex-1">
                  {needsDetails ? 'Finish setting up your account' : 'Verify your identity'}
                </Text>
              </View>
              <Text className="text-muted dark:text-muted-dark text-sm mt-2">
                {needsDetails
                  ? "You're verified — we just need a couple more details to open your Naira account number and your crypto wallet."
                  : "Confirm your details to raise your limits and unlock crypto withdrawals. With a valid BVN you're verified instantly."}
              </Text>

              <View className="mt-6" style={{ gap: 16 }}>
                <Input label="First name" value={firstName} onChangeText={setFirstName} placeholder="First name" />
                <Input label="Last name" value={lastName} onChangeText={setLastName} placeholder="Last name" />
                <View>
                  <Text className="text-muted dark:text-muted-dark text-sm font-semibold mb-1.5">
                    BVN (for instant verification)
                  </Text>
                  <TextInput
                    value={bvn}
                    onChangeText={(t) => setBvn(t.replace(/\D/g, '').slice(0, 11))}
                    keyboardType="number-pad"
                    placeholder="11-digit BVN"
                    placeholderTextColor={colors.muted}
                    className="rounded-2xl px-4 py-3.5 text-ink dark:text-ink-dark"
                    style={{ backgroundColor: colors.card, borderWidth: 1, borderColor: bvnValid ? colors.border : '#EF4444' }}
                  />
                  <Text className="text-muted dark:text-muted-dark text-xs mt-1.5">
                    Without a BVN we&apos;ll review your submission manually.
                  </Text>
                </View>

                {/* Contact and address. Grouped under a heading because the
                    user is being asked for noticeably more than a name —
                    saying what it buys them is what makes it worth filling. */}
                <View
                  className="rounded-2xl p-4 mt-2"
                  style={{ backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}
                >
                  <Text className="text-ink dark:text-ink-dark text-sm font-bold">Contact &amp; address</Text>
                  <Text className="text-muted dark:text-muted-dark text-xs mt-1">
                    {needsDetails
                      ? "This is all that's missing. Your BVN is already on file — you don't need to enter it again."
                      : 'Needed to open your dedicated Naira account number and your crypto wallet. You can skip these, but those two stay locked until you add them.'}
                  </Text>

                  <View className="mt-4" style={{ gap: 16 }}>
                    <View>
                      <Text className="text-muted dark:text-muted-dark text-sm font-semibold mb-1.5">Phone number</Text>
                      <TextInput
                        value={phone}
                        onChangeText={setPhone}
                        keyboardType="phone-pad"
                        placeholder="080 1234 5678"
                        placeholderTextColor={colors.muted}
                        className="rounded-2xl px-4 py-3.5 text-ink dark:text-ink-dark"
                        style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: phoneValid ? colors.border : '#EF4444' }}
                      />
                    </View>
                    <Input label="Street address" value={street} onChangeText={setStreet} placeholder="12 Adeola Odeku Street" />
                    <View className="flex-row" style={{ gap: 12 }}>
                      <View className="flex-1">
                        <Input label="City" value={city} onChangeText={setCity} placeholder="Lagos" />
                      </View>
                      <View className="flex-1">
                        <Input label="State" value={addrState} onChangeText={setAddrState} placeholder="Lagos" />
                      </View>
                    </View>
                    <Input label="Postal code" value={postalCode} onChangeText={setPostalCode} placeholder="101241" />
                  </View>
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
                  {submitting
                    ? needsDetails
                      ? 'Saving…'
                      : 'Verifying…'
                    : needsDetails
                      ? 'Finish setup'
                      : 'Submit for verification'}
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
      <Text className="text-muted dark:text-muted-dark text-sm font-semibold mb-1.5">{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        className="rounded-2xl px-4 py-3.5 text-ink dark:text-ink-dark"
        style={{ backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}
      />
    </View>
  );
}
