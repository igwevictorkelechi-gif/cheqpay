import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, cardEdge, CapsLabel } from '@/components/brand';
import { useFeatures } from '@/lib/useFeatures';
import DateField from '@/components/DateField';
import { api, ApiError } from '@/services/api';
import { setPin } from '@/lib/applock';

/** v2: a 3-segment, 3px progress bar — no labels, no dots. */
function Progress({ active }: { active: number }) {
  return (
    <View className="flex-row mb-6" style={{ gap: 6 }} accessibilityLabel={`Step ${active + 1} of 3`}>
      {[0, 1, 2].map((i) => (
        <View key={i} style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: i <= active ? colors.ink : colors.circle }} />
      ))}
    </View>
  );
}

type Goal = 'send' | 'bills' | 'ajo' | 'crypto';
const GOALS: { key: Goal; title: string; detail: string; icon: React.ComponentProps<typeof Ionicons>['name']; fg: string; bg: string; route: string }[] = [
  { key: 'send', title: 'Send money to people', detail: 'Free and instant to CheqPay users', icon: 'paper-plane-outline', fg: '#FF6B6B', bg: 'rgba(255,107,107,0.15)', route: '/(app)/send' },
  { key: 'bills', title: 'Pay bills and airtime', detail: 'Electricity, data, TV and more', icon: 'flash-outline', fg: '#FBBF24', bg: 'rgba(251,191,36,0.15)', route: '/(app)/pay-bill' },
  { key: 'ajo', title: 'Save with Ajo', detail: 'On your own, or in a circle with friends', icon: 'people-outline', fg: '#8A7BB5', bg: 'rgba(107,91,149,0.2)', route: '/(app)/ajo' },
  { key: 'crypto', title: 'Buy and sell crypto', detail: 'USDT, USDC and BTC, cashed out to naira', icon: 'logo-bitcoin', fg: '#A78BFA', bg: 'rgba(167,139,250,0.15)', route: '/(app)/crypto' },
];

/**
 * What verification unlocks — the real tier limits from apps/api lib/kyc.ts
 * (tier 1: ₦50,000 a payment; tier 2: ₦1,000,000). Keep in step with that file.
 */
const ASKS: { what: string; when: string; now?: boolean }[] = [
  { what: 'Email and phone', when: 'Now', now: true },
  { what: 'BVN or ID', when: 'To go above ₦50,000 a payment' },
  { what: 'More checks', when: 'Only above ₦1,000,000 a payment' },
];

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'number-pad' | 'phone-pad';
}) {
  return (
    <View className="rounded-2xl px-4 py-3 bg-card dark:bg-card-dark" style={{ borderWidth: 1, borderColor: colors.border }}>
      <Text className="text-muted dark:text-muted-dark text-xs mb-1">{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        keyboardType={keyboardType}
        autoCapitalize={keyboardType === 'number-pad' ? 'none' : 'words'}
        className="text-ink dark:text-ink-dark text-base"
        style={{ padding: 0 }}
      />
    </View>
  );
}

export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const features = useFeatures();
  const [step, setStep] = useState<'goal' | 'kyc' | 'pin'>('goal');
  const [goal, setGoal] = useState<Goal | null>(null);
  const goals = GOALS.filter(
    (g) =>
      (g.key !== 'ajo' || features.ajo) &&
      (g.key !== 'crypto' || features.crypto_trading) &&
      (g.key !== 'bills' || features.bill_payments),
  );

  // KYC
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dob, setDob] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // PIN
  const [pin, setPinValue] = useState('');
  const [confirm, setConfirm] = useState('');
  const [savingPin, setSavingPin] = useState(false);

  const kycValid = firstName.trim().length >= 2 && lastName.trim().length >= 2;

  // Straight to the thing they said they came for, or Home.
  const finish = () => router.replace((GOALS.find((g) => g.key === goal)?.route ?? '/(app)/home') as never);

  const submitKyc = async () => {
    if (!kycValid) return;
    setSubmitting(true);
    setError(null);
    try {
      // Full KYC (BVN + government ID with document photos) happens on the Verify
      // screen, which needs image uploads. Here we only save the date of birth so
      // the Verify screen can prefill it; the name is already on the auth profile.
      if (/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
        await api.updateProfile({ dateOfBirth: dob });
      }
      setStep('pin');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not submit. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const savePin = async () => {
    if (pin.length < 4 || pin !== confirm) return;
    setSavingPin(true);
    try {
      await setPin(pin);
      finish();
    } finally {
      setSavingPin(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1">
      <View className="flex-1" style={{ backgroundColor: colors.surface, paddingTop: insets.top + 12 }}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
        >
          <Progress active={step === 'goal' ? 0 : step === 'kyc' ? 1 : 2} />

          {step === 'goal' ? (
            <>
              <Text style={{ color: colors.ink, fontSize: 24, lineHeight: 30, fontWeight: '700', letterSpacing: -0.5, marginBottom: 8 }}>
                What should CheqPay do for you first?
              </Text>
              <Text style={{ color: colors.muted, fontSize: 15, lineHeight: 22, marginBottom: 24 }}>
                We'll take you straight there once you're set up.
              </Text>

              <View accessibilityRole="radiogroup" style={[{ backgroundColor: colors.card, borderRadius: 24, overflow: 'hidden' }, cardEdge()]}>
                {goals.map((g, i) => {
                  const on = goal === g.key;
                  return (
                    <TouchableOpacity
                      key={g.key}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: on }}
                      activeOpacity={0.7}
                      onPress={() => setGoal(g.key)}
                      className="flex-row items-center pl-4"
                    >
                      <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: g.bg, alignItems: 'center', justifyContent: 'center' }}>
                        <Ionicons name={g.icon} size={20} color={g.fg} />
                      </View>
                      <View
                        className="flex-1 flex-row items-center ml-3 pr-4"
                        style={[{ paddingVertical: 14 }, i > 0 ? { borderTopWidth: 1, borderTopColor: colors.hairline } : null]}
                      >
                        <View className="flex-1">
                          <Text style={{ color: colors.ink, fontSize: 15, fontWeight: '600' }}>{g.title}</Text>
                          <Text style={{ color: colors.muted, fontSize: 13 }}>{g.detail}</Text>
                        </View>
                        <View
                          style={{
                            width: 22,
                            height: 22,
                            borderRadius: 11,
                            borderWidth: 2,
                            borderColor: on ? colors.brand : colors.border,
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          {on && <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.brand }} />}
                        </View>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <CapsLabel style={{ marginTop: 24, marginBottom: 10 }}>What we'll ask for</CapsLabel>
              {ASKS.map((a) => (
                <View key={a.what} className="flex-row items-center justify-between" style={{ minHeight: 36, gap: 16 }}>
                  <Text style={{ color: colors.ink, fontSize: 15 }}>{a.what}</Text>
                  {a.now ? (
                    <View style={{ backgroundColor: 'rgba(107,91,149,0.2)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 2 }}>
                      <Text style={{ color: colors.brandLight, fontSize: 10, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' }}>{a.when}</Text>
                    </View>
                  ) : (
                    <Text style={{ color: colors.muted, fontSize: 13, textAlign: 'right', flexShrink: 1 }}>{a.when}</Text>
                  )}
                </View>
              ))}

              <TouchableOpacity
                onPress={() => setStep('kyc')}
                disabled={!goal}
                className="mt-6 rounded-full items-center justify-center"
                style={{ height: 54, backgroundColor: goal ? colors.brand : colors.card }}
              >
                <Text style={{ color: goal ? '#fff' : colors.muted, fontSize: 16, fontWeight: '700' }}>Continue</Text>
              </TouchableOpacity>
              <Text style={{ color: colors.muted, fontSize: 13, textAlign: 'center', marginTop: 12 }}>Takes about 2 minutes</Text>
            </>
          ) : step === 'kyc' ? (
            <>
              <Text className="mb-2" style={{ color: colors.ink, fontSize: 24, lineHeight: 30, fontWeight: '700', letterSpacing: -0.5 }}>Tell us about you</Text>
              <Text className="text-muted dark:text-muted-dark text-base mb-6">
                Just your name to get started. You&apos;ll verify your identity with a BVN and a
                government ID from the Verify screen, which unlocks higher limits, deposits and crypto
                withdrawals.
              </Text>

              <View style={{ gap: 14 }}>
                <Field label="First name" value={firstName} onChangeText={setFirstName} placeholder="First name" />
                <Field label="Last name" value={lastName} onChangeText={setLastName} placeholder="Last name" />
                <DateField
                  label="Date of birth (optional)"
                  value={dob}
                  onChange={setDob}
                  hint="We'll prefill it on the Verify screen."
                />
              </View>

              {error && <Text className="text-sm mt-3" style={{ color: '#EF4444' }}>{error}</Text>}

              <TouchableOpacity
                onPress={submitKyc}
                disabled={!kycValid || submitting}
                className="rounded-full py-4 items-center mt-6"
                style={{ backgroundColor: kycValid && !submitting ? colors.brand : colors.circle }}
              >
                {submitting ? <ActivityIndicator color="#FFFFFF" /> : <Text className="text-white text-base font-bold">Continue</Text>}
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setStep('pin')} className="py-4 items-center">
                <Text className="text-muted dark:text-muted-dark text-sm font-semibold">Skip for now</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text className="mb-2" style={{ color: colors.ink, fontSize: 24, lineHeight: 30, fontWeight: '700', letterSpacing: -0.5 }}>Set up your PIN</Text>
              <Text className="text-muted dark:text-muted-dark text-base mb-6">
                Create a PIN to lock the app. You’ll enter it each time you open CheqPay.
              </Text>

              <View style={{ gap: 14 }}>
                <View className="rounded-2xl px-4 py-3 bg-card dark:bg-card-dark" style={{ borderWidth: 1, borderColor: colors.border }}>
                  <Text className="text-muted dark:text-muted-dark text-xs mb-1">Enter a PIN (4–6 digits)</Text>
                  <TextInput
                    value={pin}
                    onChangeText={(t) => setPinValue(t.replace(/\D/g, '').slice(0, 6))}
                    keyboardType="number-pad"
                    secureTextEntry
                    className="text-ink dark:text-ink-dark text-2xl"
                    style={{ padding: 0, letterSpacing: 8 }}
                  />
                </View>
                <View className="rounded-2xl px-4 py-3 bg-card dark:bg-card-dark" style={{ borderWidth: 1, borderColor: colors.border }}>
                  <Text className="text-muted dark:text-muted-dark text-xs mb-1">Confirm PIN</Text>
                  <TextInput
                    value={confirm}
                    onChangeText={(t) => setConfirm(t.replace(/\D/g, '').slice(0, 6))}
                    keyboardType="number-pad"
                    secureTextEntry
                    className="text-ink dark:text-ink-dark text-2xl"
                    style={{ padding: 0, letterSpacing: 8 }}
                  />
                </View>
              </View>

              {confirm.length > 0 && pin !== confirm && (
                <Text className="text-sm mt-3" style={{ color: '#EF4444' }}>PINs don’t match.</Text>
              )}

              <TouchableOpacity
                onPress={savePin}
                disabled={pin.length < 4 || pin !== confirm || savingPin}
                className="rounded-full py-4 items-center mt-6"
                style={{ backgroundColor: pin.length >= 4 && pin === confirm && !savingPin ? colors.brand : colors.circle }}
              >
                {savingPin ? <ActivityIndicator color="#FFFFFF" /> : <Text className="text-white text-base font-bold">Finish setup</Text>}
              </TouchableOpacity>
              <TouchableOpacity onPress={finish} className="py-4 items-center">
                <Text className="text-muted dark:text-muted-dark text-sm font-semibold">Skip for now</Text>
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}
