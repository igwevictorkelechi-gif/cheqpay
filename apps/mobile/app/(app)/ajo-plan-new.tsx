import { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { colors } from '@/components/brand';
import { SuccessAnimation } from '@/components/Lottie';
import { useTransactionPin, PIN_CANCELLED } from '@/components/TransactionPinProvider';
import { api, ApiError, type AjoFrequency, type AjoPlan } from '@/services/api';
import { GOALS, PRESETS, dueLabel, every, everyPlural, ngn, splitGoal } from '@/lib/ajo';

const FREQS: { key: AjoFrequency; label: string }[] = [
  { key: 'daily', label: 'Daily' },
  { key: 'weekly', label: 'Weekly' },
  { key: 'monthly', label: 'Monthly' },
];
const SUGGESTED: Record<AjoFrequency, number[]> = { daily: [30, 60, 90], weekly: [4, 12, 26, 52], monthly: [3, 6, 12] };
const MAX: Record<AjoFrequency, number> = { daily: 366, weekly: 104, monthly: 60 };

/** Start a solo Ajo plan: a goal, an amount, a rhythm, how many times. */
export default function AjoPlanNewScreen() {
  const insets = useSafeAreaInsets();
  const { authorize } = useTransactionPin();
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [freq, setFreq] = useState<AjoFrequency>('weekly');
  const [count, setCount] = useState('12');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<AjoPlan | null>(null);

  const n = Number(count) || 0;
  const amt = Number(amount) || 0;
  const valid = name.trim().length >= 2 && amt >= 100 && n >= 2 && n <= MAX[freq];
  const goal = GOALS.find((g) => `${g.emoji} ${g.label}` === name.trim());

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const { plan } = await authorize(
        (pin) => api.createAjoPlan({ name: name.trim(), amount, frequency: freq, count: n }, pin),
        { title: 'Lock it in', detail: `Enter your transaction PIN. ${ngn(amt)} is saved now, then every ${every[freq]}.` },
      );
      setDone(plan);
    } catch (e) {
      if (e instanceof Error && e.message === PIN_CANCELLED) return;
      setError(e instanceof ApiError ? e.message : 'Couldn’t start the plan. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const chip = (on: boolean) => ({ backgroundColor: on ? colors.brand : colors.card });
  const chipText = (on: boolean) => ({ color: on ? colors.white : colors.muted, fontWeight: '700' as const, fontSize: 13 });

  if (done) {
    const { emoji, label } = splitGoal(done.name);
    return (
      <View className="flex-1 items-center justify-center px-8" style={{ backgroundColor: colors.surface }}>
        <SuccessAnimation />
        <Text style={{ fontSize: 40, marginTop: 8 }}>{emoji}</Text>
        <Text className="text-ink dark:text-ink-dark text-2xl font-extrabold mt-3 text-center">
          {ngn(done.amount)} locked in
        </Text>
        <Text className="text-muted dark:text-muted-dark text-sm mt-2 text-center">
          “{label}” is on. The next {ngn(done.amount)} goes in {dueLabel(done.nextDueAt).toLowerCase()}, and{' '}
          {ngn(done.target)} comes back to you when it’s done.
        </Text>
        <TouchableOpacity
          onPress={() => router.replace('/(app)/ajo')}
          className="mt-8 w-full items-center py-4 rounded-full"
          style={{ backgroundColor: colors.brand }}
        >
          <Text style={{ color: colors.white, fontWeight: '700', fontSize: 16 }}>See my plans</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => {
            setDone(null);
            setName('');
            setAmount('');
          }}
          className="mt-4"
        >
          <Text style={{ color: colors.brandLight, fontWeight: '600' }}>Start another</Text>
        </TouchableOpacity>
      </View>
    );
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
        <Text className="text-ink dark:text-ink-dark text-lg font-bold ml-3">New plan</Text>
      </View>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 40 }}
      >
        <Text className="text-muted dark:text-muted-dark text-sm font-semibold mt-4 mb-2">What’s it for?</Text>
        <View className="flex-row flex-wrap" style={{ gap: 8 }}>
          {GOALS.map((g) => {
            const on = goal?.label === g.label;
            return (
              <TouchableOpacity
                key={g.label}
                onPress={() => setName(on ? '' : `${g.emoji} ${g.label}`)}
                className="px-3 py-2 rounded-full flex-row items-center"
                style={chip(on)}
              >
                <Text style={{ fontSize: 14, marginRight: 5 }}>{g.emoji}</Text>
                <Text style={chipText(on)}>{g.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <TextInput
          value={name}
          onChangeText={setName}
          maxLength={40}
          placeholder="…or type your own goal"
          placeholderTextColor={colors.muted}
          className="rounded-2xl px-4 py-3.5 text-ink dark:text-ink-dark text-base mt-3"
          style={{ backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}
        />

        <Text className="text-muted dark:text-muted-dark text-sm font-semibold mt-6 mb-2">Quick start</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {PRESETS.map((p) => {
            const on = amount === p.amount && freq === p.frequency && n === p.count;
            return (
              <TouchableOpacity
                key={p.label}
                onPress={() => {
                  setAmount(p.amount);
                  setFreq(p.frequency);
                  setCount(String(p.count));
                }}
                className="px-4 py-3 rounded-2xl"
                style={{ backgroundColor: on ? colors.brand : colors.card, minWidth: 150 }}
              >
                <Text style={{ color: on ? colors.white : colors.ink, fontWeight: '700', fontSize: 13 }}>{p.label}</Text>
                <Text style={{ color: on ? 'rgba(255,255,255,0.8)' : colors.muted, fontSize: 11, marginTop: 2 }}>
                  = {ngn(Number(p.amount) * p.count)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <Text className="text-muted dark:text-muted-dark text-sm font-semibold mt-6 mb-2">How often</Text>
        <View className="flex-row" style={{ gap: 8 }}>
          {FREQS.map((f) => (
            <TouchableOpacity
              key={f.key}
              onPress={() => {
                setFreq(f.key);
                if (n > MAX[f.key]) setCount(String(MAX[f.key]));
              }}
              className="px-4 py-2 rounded-full"
              style={chip(f.key === freq)}
            >
              <Text style={chipText(f.key === freq)}>{f.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text className="text-muted dark:text-muted-dark text-sm font-semibold mt-6 mb-2">Each {every[freq]}</Text>
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

        <Text className="text-muted dark:text-muted-dark text-sm font-semibold mt-6 mb-2">
          For how many {everyPlural[freq]}
        </Text>
        <View className="flex-row flex-wrap" style={{ gap: 8 }}>
          {SUGGESTED[freq].map((c) => (
            <TouchableOpacity key={c} onPress={() => setCount(String(c))} className="px-4 py-2 rounded-full" style={chip(n === c)}>
              <Text style={chipText(n === c)}>{c}</Text>
            </TouchableOpacity>
          ))}
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
            A {freq} plan can run for at most {MAX[freq]} {everyPlural[freq]}.
          </Text>
        )}

        {valid && (
          <View className="mt-6 px-4 py-4 rounded-3xl" style={{ backgroundColor: colors.card }}>
            <Text className="text-ink dark:text-ink-dark font-bold text-base">
              {ngn(amt * n)} by the end {goal ? `· ${goal.emoji}` : ''}
            </Text>
            {[
              `${ngn(amt)} leaves your wallet now, then at 9am every ${every[freq]}. Nothing to remember.`,
              'Short on a day? That one’s skipped, no penalty, and the plan keeps going.',
              'The whole pot comes back to your wallet the day the last one goes in. Free.',
              'Need it sooner? End the plan any time. A small break fee applies.',
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
            {valid ? `Lock in ${ngn(amt)}` : 'Lock it in'}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}
