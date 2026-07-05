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
import { colors } from '@/components/brand';
import { api, ApiError } from '@/services/api';
import { setPin } from '@/lib/applock';

const STEPS = ['Account', 'Email', 'Identity', 'PIN'];

function Progress({ active }: { active: number }) {
  return (
    <View className="flex-row items-center mb-8" style={{ gap: 8 }}>
      {STEPS.map((label, i) => {
        const done = i < active;
        const isActive = i === active;
        return (
          <View key={label} className="flex-1 items-center">
            <View
              className="w-full rounded-full"
              style={{ height: 4, backgroundColor: done || isActive ? colors.brand : colors.circle }}
            />
            <Text
              className="text-xs mt-2"
              style={{ color: done || isActive ? colors.ink : colors.muted, fontWeight: isActive ? '700' : '500' }}
            >
              {label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

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
  keyboardType?: 'default' | 'number-pad';
}) {
  return (
    <View className="rounded-2xl px-4 py-3 bg-card" style={{ borderWidth: 1, borderColor: colors.border }}>
      <Text className="text-muted text-xs mb-1">{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        keyboardType={keyboardType}
        autoCapitalize={keyboardType === 'number-pad' ? 'none' : 'words'}
        className="text-ink text-base"
        style={{ padding: 0 }}
      />
    </View>
  );
}

export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<'kyc' | 'pin'>('kyc');

  // KYC
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dob, setDob] = useState('');
  const [bvn, setBvn] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // PIN
  const [pin, setPinValue] = useState('');
  const [confirm, setConfirm] = useState('');
  const [savingPin, setSavingPin] = useState(false);

  const kycValid = firstName.trim().length >= 2 && lastName.trim().length >= 2;

  const finish = () => router.replace('/(app)/home');

  const submitKyc = async () => {
    if (!kycValid) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.submitKyc({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        dateOfBirth: /^\d{4}-\d{2}-\d{2}$/.test(dob) ? dob : undefined,
        bvn: bvn.trim() || undefined,
      });
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
          <Progress active={step === 'kyc' ? 2 : 3} />

          {step === 'kyc' ? (
            <>
              <Text className="text-ink text-3xl font-extrabold mb-2">Verify your identity</Text>
              <Text className="text-muted text-base mb-6">
                A quick check unlocks higher limits and crypto withdrawals. Your BVN name is matched
                automatically.
              </Text>

              <View style={{ gap: 14 }}>
                <Field label="First name" value={firstName} onChangeText={setFirstName} placeholder="First name" />
                <Field label="Last name" value={lastName} onChangeText={setLastName} placeholder="Last name" />
                <Field label="Date of birth (optional)" value={dob} onChangeText={setDob} placeholder="YYYY-MM-DD" />
                <Field label="BVN (optional)" value={bvn} onChangeText={(t) => setBvn(t.replace(/\D/g, '').slice(0, 11))} placeholder="11-digit BVN" keyboardType="number-pad" />
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
                <Text className="text-muted text-sm font-semibold">Skip for now</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text className="text-ink text-3xl font-extrabold mb-2">Set up your PIN</Text>
              <Text className="text-muted text-base mb-6">
                Create a PIN to lock the app. You’ll enter it each time you open CheqPay.
              </Text>

              <View style={{ gap: 14 }}>
                <View className="rounded-2xl px-4 py-3 bg-card" style={{ borderWidth: 1, borderColor: colors.border }}>
                  <Text className="text-muted text-xs mb-1">Enter a PIN (4–6 digits)</Text>
                  <TextInput
                    value={pin}
                    onChangeText={(t) => setPinValue(t.replace(/\D/g, '').slice(0, 6))}
                    keyboardType="number-pad"
                    secureTextEntry
                    className="text-ink text-2xl"
                    style={{ padding: 0, letterSpacing: 8 }}
                  />
                </View>
                <View className="rounded-2xl px-4 py-3 bg-card" style={{ borderWidth: 1, borderColor: colors.border }}>
                  <Text className="text-muted text-xs mb-1">Confirm PIN</Text>
                  <TextInput
                    value={confirm}
                    onChangeText={(t) => setConfirm(t.replace(/\D/g, '').slice(0, 6))}
                    keyboardType="number-pad"
                    secureTextEntry
                    className="text-ink text-2xl"
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
                <Text className="text-muted text-sm font-semibold">Skip for now</Text>
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}
