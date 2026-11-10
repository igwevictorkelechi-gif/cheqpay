import { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { colors } from '@/components/brand';
import { useTransactionPin, PIN_CANCELLED } from '@/components/TransactionPinProvider';
import { api, ApiError, type AjoFrequency } from '@/services/api';
import { GROUP_TERMS, every, ngn } from '@/lib/ajo';

const FREQS: { key: AjoFrequency; label: string }[] = [
  { key: 'daily', label: 'Daily' },
  { key: 'weekly', label: 'Weekly' },
  { key: 'monthly', label: 'Monthly' },
];

/**
 * Group Ajo: join a group with its invite code, or start a new one. Both make
 * the user a member, so both show the terms and need the transaction PIN.
 */
export default function AjoGroupNewScreen() {
  const insets = useSafeAreaInsets();
  const { authorize } = useTransactionPin();
  const params = useLocalSearchParams<{ code?: string }>();
  const [mode, setMode] = useState<'join' | 'create'>('join');
  const [code, setCode] = useState(params.code ?? '');
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [freq, setFreq] = useState<AjoFrequency>('monthly');
  const [size, setSize] = useState('5');
  const [order, setOrder] = useState<'random' | 'join'>('random');
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amt = Number(amount) || 0;
  const members = Number(size) || 0;
  const cleanCode = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const valid =
    agreed &&
    (mode === 'join'
      ? cleanCode.length === 6
      : name.trim().length >= 2 && amt >= 100 && members >= 2 && members <= 30);

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const { group } =
        mode === 'join'
          ? await authorize((pin) => api.joinAjoGroup(cleanCode, pin), {
              title: 'Join Ajo group',
              detail: 'Enter your transaction PIN to join and allow the contributions to be taken from your wallet.',
            })
          : await authorize(
              (pin) =>
                api.createAjoGroup(
                  { name: name.trim(), amount, frequency: freq, size: members, payoutOrder: order, acceptTerms: true },
                  pin,
                ),
              { title: 'Create Ajo group', detail: 'Enter your transaction PIN to create the group and join it.' },
            );
      router.replace({ pathname: '/(app)/ajo-group/[id]', params: { id: group.id } });
    } catch (e) {
      if (e instanceof Error && e.message === PIN_CANCELLED) return;
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const chip = (on: boolean) => ({ backgroundColor: on ? colors.brand : colors.card });
  const chipText = (on: boolean) => ({ color: on ? colors.white : colors.muted, fontWeight: '700' as const, fontSize: 13 });
  const input = { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border };

  return (
    <View className="flex-1" style={{ backgroundColor: colors.surface, paddingTop: insets.top }}>
      <View className="flex-row items-center px-5 pt-3 pb-2">
        <TouchableOpacity
          onPress={() => router.back()}
          className="w-10 h-10 rounded-full bg-card dark:bg-card-dark items-center justify-center"
        >
          <Ionicons name="chevron-back" size={22} color={colors.ink} />
        </TouchableOpacity>
        <Text className="text-ink dark:text-ink-dark text-lg font-bold ml-3">Group Ajo</Text>
      </View>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 40 }}
      >
        <View className="flex-row mt-2 p-1 rounded-full" style={{ backgroundColor: colors.card }}>
          {(['join', 'create'] as const).map((m) => (
            <TouchableOpacity
              key={m}
              onPress={() => {
                setMode(m);
                setError(null);
              }}
              className="flex-1 py-2.5 rounded-full items-center"
              style={{ backgroundColor: mode === m ? colors.brand : 'transparent' }}
            >
              <Text style={chipText(mode === m)}>{m === 'join' ? 'Join my people' : 'Start a group'}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {mode === 'join' ? (
          <>
            <Text className="text-muted dark:text-muted-dark text-sm font-semibold mt-6 mb-2">Invite code</Text>
            <TextInput
              value={code}
              onChangeText={(t) => setCode(t.toUpperCase())}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={8}
              placeholder="e.g. K7M2QX"
              placeholderTextColor={colors.muted}
              className="rounded-2xl px-4 py-3.5 text-ink dark:text-ink-dark text-xl font-bold"
              style={[input, { letterSpacing: 4 }]}
            />
            <Text className="text-muted dark:text-muted-dark text-xs mt-2">
              Got a link from a friend? Tapping it fills this in. Otherwise ask them for the 6-character code.
            </Text>
          </>
        ) : (
          <>
            <Text className="text-muted dark:text-muted-dark text-sm font-semibold mt-6 mb-2">Group name</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              maxLength={40}
              placeholder="Office Ajo, Squad fund, Family…"
              placeholderTextColor={colors.muted}
              className="rounded-2xl px-4 py-3.5 text-ink dark:text-ink-dark text-base"
              style={input}
            />

            <Text className="text-muted dark:text-muted-dark text-sm font-semibold mt-6 mb-2">How often</Text>
            <View className="flex-row" style={{ gap: 8 }}>
              {FREQS.map((f) => (
                <TouchableOpacity key={f.key} onPress={() => setFreq(f.key)} className="px-4 py-2 rounded-full" style={chip(f.key === freq)}>
                  <Text style={chipText(f.key === freq)}>{f.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text className="text-muted dark:text-muted-dark text-sm font-semibold mt-6 mb-2">
              Each member pays, every {every[freq]}
            </Text>
            <View className="flex-row items-center rounded-2xl px-4 py-3.5" style={input}>
              <Text className="text-muted dark:text-muted-dark text-lg font-bold mr-1">₦</Text>
              <TextInput
                value={amount}
                onChangeText={(t) => {
                  const [w, ...rest] = t.replace(/[^\d.]/g, '').split('.');
                  setAmount(rest.length ? `${w}.${rest.join('').slice(0, 2)}` : w);
                }}
                keyboardType="decimal-pad"
                placeholder="10,000"
                placeholderTextColor={colors.muted}
                className="flex-1 text-ink dark:text-ink-dark text-lg font-bold"
              />
            </View>

            <Text className="text-muted dark:text-muted-dark text-sm font-semibold mt-6 mb-2">Members (2 to 30)</Text>
            <TextInput
              value={size}
              onChangeText={(t) => setSize(t.replace(/\D/g, '').slice(0, 2))}
              keyboardType="number-pad"
              className="rounded-2xl px-4 py-3.5 text-ink dark:text-ink-dark text-base font-bold"
              style={input}
            />

            <Text className="text-muted dark:text-muted-dark text-sm font-semibold mt-6 mb-2">Who collects first</Text>
            <View className="flex-row" style={{ gap: 8 }}>
              <TouchableOpacity onPress={() => setOrder('random')} className="px-4 py-2 rounded-full" style={chip(order === 'random')}>
                <Text style={chipText(order === 'random')}>Random draw</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setOrder('join')} className="px-4 py-2 rounded-full" style={chip(order === 'join')}>
                <Text style={chipText(order === 'join')}>Order joined</Text>
              </TouchableOpacity>
            </View>
            <Text className="text-muted dark:text-muted-dark text-xs mt-2">
              {order === 'random'
                ? 'The order is drawn fairly when you start the group. Nobody, you included, can pick their spot.'
                : 'Whoever joins first collects first. You joined first, so you collect in round 1.'}
            </Text>

            {amt >= 100 && members >= 2 && (
              <View className="mt-5 px-4 py-4 rounded-3xl" style={{ backgroundColor: colors.card }}>
                <Text className="text-ink dark:text-ink-dark font-semibold">
                  Each round’s pot: {ngn(amt * members)}
                </Text>
                <Text className="text-muted dark:text-muted-dark text-xs mt-1">
                  {members} rounds, one every {every[freq]}. Everyone collects once.
                </Text>
              </View>
            )}
          </>
        )}

        {/* Terms */}
        <View className="mt-6 px-4 py-4 rounded-3xl" style={{ backgroundColor: colors.card }}>
          <Text className="text-ink dark:text-ink-dark font-semibold mb-1">How group Ajo works</Text>
          {GROUP_TERMS.map((t) => (
            <View key={t} className="flex-row mt-1.5">
              <Text className="text-muted dark:text-muted-dark text-xs mr-2">•</Text>
              <Text className="text-muted dark:text-muted-dark text-xs flex-1">{t}</Text>
            </View>
          ))}
          <TouchableOpacity onPress={() => setAgreed((a) => !a)} className="flex-row items-center mt-4">
            <Ionicons name={agreed ? 'checkbox' : 'square-outline'} size={22} color={agreed ? colors.brand : colors.muted} />
            <Text className="text-ink dark:text-ink-dark text-sm ml-2 flex-1">I understand and agree</Text>
          </TouchableOpacity>
        </View>

        {error && <Text style={{ color: '#F87171', marginTop: 12 }}>{error}</Text>}

        <TouchableOpacity
          onPress={submit}
          disabled={!valid || busy}
          className="mt-6 flex-row items-center justify-center py-4 rounded-full"
          style={{ backgroundColor: colors.brand, opacity: valid && !busy ? 1 : 0.5 }}
        >
          {busy && <ActivityIndicator color={colors.white} style={{ marginRight: 8 }} />}
          <Text style={{ color: colors.white, fontWeight: '700', fontSize: 16 }}>
            {mode === 'join' ? 'Join group' : 'Create group'}
          </Text>
        </TouchableOpacity>
        <Text className="text-muted dark:text-muted-dark text-xs mt-3 text-center">
          Group Ajo needs a verified government ID (Tier 2).
        </Text>
      </ScrollView>
    </View>
  );
}
