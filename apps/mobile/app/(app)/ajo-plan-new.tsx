import { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, TextInput, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { colors } from '@/components/brand';
import { useTransactionPin, PIN_CANCELLED } from '@/components/TransactionPinProvider';
import { api, ApiError, type AjoFrequency } from '@/services/api';
import { every, ngn } from '@/lib/ajo';

const FREQS: { key: AjoFrequency; label: string }[] = [
  { key: 'daily', label: 'Daily' },
  { key: 'weekly', label: 'Weekly' },
  { key: 'monthly', label: 'Monthly' },
];
const SUGGESTED: Record<AjoFrequency, number[]> = { daily: [30, 90, 180], weekly: [4, 12, 26, 52], monthly: [3, 6, 12] };
const MAX: Record<AjoFrequency, number> = { daily: 366, weekly: 104, monthly: 60 };

/** Start a personal Ajo plan: name, amount, how often, how many times. */
export default function AjoPlanNewScreen() {
  const insets = useSafeAreaInsets();
  const { authorize } = useTransactionPin();
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [freq, setFreq] = useState<AjoFrequency>('weekly');
  const [count, setCount] = useState('12');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const n = Number(count) || 0;
  const amt = Number(amount) || 0;
  const valid = name.trim().length >= 2 && amt >= 100 && n >= 2 && n <= MAX[freq];

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      await authorize(
        (pin) => api.createAjoPlan({ name: name.trim(), amount, frequency: freq, count: n }, pin),
        { title: 'Start Ajo plan', detail: `Enter your transaction PIN. ${ngn(amt)} is taken now, then every ${every[freq]}.` },
      );
      Alert.alert('Plan started', `Your first ${ngn(amt)} is saved. We’ll take the next one automatically.`);
      router.back();
    } catch (e) {
      if (e instanceof Error && e.message === PIN_CANCELLED) return;
      setError(e instanceof ApiError ? e.message : 'Couldn’t start the plan. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View className="flex-1" style={{ backgroundColor: colors.surface, paddingTop: insets.top }}>
      <View className="flex-row items-center px-5 pt-3 pb-2">
        <TouchableOpacity
          onPress={() => router.back()}
          className="w-10 h-10 rounded-full bg-card dark:bg-card-dark items-center justify-center"
        >
          <Ionicons name="chevron-back" size={22} color={colors.ink} />
        </TouchableOpacity>
        <Text className="text-ink dark:text-ink-dark text-lg font-bold ml-3">New Ajo plan</Text>
      </View>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 40 }}
      >
        <Text className="text-muted dark:text-muted-dark text-sm font-semibold mt-4 mb-2">What are you saving for?</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          maxLength={40}
          placeholder="Rent, school fees, a new phone…"
          placeholderTextColor={colors.muted}
          className="rounded-2xl px-4 py-3.5 text-ink dark:text-ink-dark text-base"
          style={{ backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}
        />

        <Text className="text-muted dark:text-muted-dark text-sm font-semibold mt-6 mb-2">How often</Text>
        <View className="flex-row" style={{ gap: 8 }}>
          {FREQS.map((f) => {
            const on = f.key === freq;
            return (
              <TouchableOpacity
                key={f.key}
                onPress={() => {
                  setFreq(f.key);
                  if (n > MAX[f.key]) setCount(String(MAX[f.key]));
                }}
                className="px-4 py-2 rounded-full"
                style={{ backgroundColor: on ? colors.brand : colors.card }}
              >
                <Text style={{ color: on ? colors.white : colors.muted, fontWeight: '700', fontSize: 13 }}>{f.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text className="text-muted dark:text-muted-dark text-sm font-semibold mt-6 mb-2">Amount each {every[freq]}</Text>
        <View
          className="flex-row items-center rounded-2xl px-4 py-3.5"
          style={{ backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}
        >
          <Text className="text-muted dark:text-muted-dark text-lg font-bold mr-1">₦</Text>
          <TextInput
            value={amount}
            onChangeText={(t) => {
              const [w, ...rest] = t.replace(/[^\d.]/g, '').split('.');
              setAmount(rest.length ? `${w}.${rest.join('').slice(0, 2)}` : w);
            }}
            keyboardType="decimal-pad"
            placeholder="5,000"
            placeholderTextColor={colors.muted}
            className="flex-1 text-ink dark:text-ink-dark text-lg font-bold"
          />
        </View>

        <Text className="text-muted dark:text-muted-dark text-sm font-semibold mt-6 mb-2">How many times</Text>
        <View className="flex-row flex-wrap" style={{ gap: 8 }}>
          {SUGGESTED[freq].map((c) => {
            const on = n === c;
            return (
              <TouchableOpacity
                key={c}
                onPress={() => setCount(String(c))}
                className="px-4 py-2 rounded-full"
                style={{ backgroundColor: on ? colors.brand : colors.card }}
              >
                <Text style={{ color: on ? colors.white : colors.muted, fontWeight: '700', fontSize: 13 }}>{c}</Text>
              </TouchableOpacity>
            );
          })}
          <TextInput
            value={count}
            onChangeText={(t) => setCount(t.replace(/\D/g, '').slice(0, 3))}
            keyboardType="number-pad"
            className="px-4 py-2 rounded-full text-ink dark:text-ink-dark font-bold"
            style={{ backgroundColor: colors.card, minWidth: 64, textAlign: 'center' }}
          />
        </View>
        {n > MAX[freq] && (
          <Text style={{ color: '#F87171', marginTop: 6, fontSize: 12 }}>
            A {freq} plan can have at most {MAX[freq]} contributions.
          </Text>
        )}

        {valid && (
          <View className="mt-6 px-4 py-4 rounded-3xl" style={{ backgroundColor: colors.card }}>
            <Text className="text-ink dark:text-ink-dark font-semibold">
              You’ll save {ngn(amt * n)} in total
            </Text>
            {[
              `${ngn(amt)} is taken from your wallet now, then at 9am every ${every[freq]}.`,
              'When the last one is taken, everything comes back to your wallet. No fee.',
              'If your wallet is short on a due date, that one is skipped and the plan carries on.',
              'You can end it early: you get your savings back minus a small break fee.',
            ].map((t) => (
              <View key={t} className="flex-row mt-1.5">
                <Text className="text-muted dark:text-muted-dark text-xs mr-2">•</Text>
                <Text className="text-muted dark:text-muted-dark text-xs flex-1">{t}</Text>
              </View>
            ))}
          </View>
        )}

        {error && <Text style={{ color: '#F87171', marginTop: 12 }}>{error}</Text>}

        <TouchableOpacity
          onPress={submit}
          disabled={!valid || busy}
          className="mt-6 flex-row items-center justify-center py-4 rounded-full"
          style={{ backgroundColor: colors.brand, opacity: valid && !busy ? 1 : 0.5 }}
        >
          {busy && <ActivityIndicator color={colors.white} style={{ marginRight: 8 }} />}
          <Text style={{ color: colors.white, fontWeight: '700', fontSize: 16 }}>
            {valid ? `Save ${ngn(amt)} now` : 'Start plan'}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}
