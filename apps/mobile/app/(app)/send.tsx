import { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { colors, CapsLabel, cardEdge } from '@/components/brand';
import { useFeatures } from '@/lib/useFeatures';
import { detectPayTarget, payTargetHint, type PayTarget } from '@/lib/payTarget';
import { api, type Beneficiary } from '@/services/api';

type Recent =
  | { kind: 'user'; key: string; username: string }
  | { kind: 'bank'; key: string; b: Beneficiary };

const BILLS: { service: string; label: string; icon: React.ComponentProps<typeof Ionicons>['name'] }[] = [
  { service: 'airtime', label: 'Airtime', icon: 'phone-portrait-outline' },
  { service: 'data', label: 'Data', icon: 'wifi-outline' },
  { service: 'electricity', label: 'Electricity', icon: 'flash-outline' },
  { service: 'cabletv', label: 'TV', icon: 'tv-outline' },
  { service: 'betting', label: 'Betting', icon: 'dice-outline' },
];

/**
 * v2 Pay: one place to send money. A single "To" field works out where the
 * money goes — an @username (CheqPay user, instant), the user's own 10-digit
 * bank account (a withdrawal; payouts are name-matched, so only their own), a
 * phone (airtime/data) or a meter/smartcard number (a bill) — and says so as
 * they type. Every path ends in the existing screen for that payment, so
 * amounts, fees, limits and the PIN work exactly as before.
 */
export default function PayScreen() {
  const insets = useSafeAreaInsets();
  const features = useFeatures();
  const [to, setTo] = useState('');
  const [focused, setFocused] = useState(false);
  const [recents, setRecents] = useState<Recent[]>([]);
  const target: PayTarget = useMemo(() => detectPayTarget(to), [to]);

  useEffect(() => {
    let active = true;
    (async () => {
      const [txns, bens] = await Promise.all([
        api.getTransactions(30, 'NGN').catch(() => ({ transactions: [] })),
        api.getBeneficiaries().catch(() => ({ beneficiaries: [] as Beneficiary[] })),
      ]);
      if (!active) return;
      const seen = new Set<string>();
      const users: Recent[] = [];
      for (const t of txns.transactions) {
        if (t.type !== 'TRANSFER_OUT' || !t.counterparty || seen.has(t.counterparty)) continue;
        seen.add(t.counterparty);
        users.push({ kind: 'user', key: `u:${t.counterparty}`, username: t.counterparty });
        if (users.length === 3) break;
      }
      const banks: Recent[] = bens.beneficiaries.slice(0, 2).map((b) => ({ kind: 'bank', key: `b:${b.id}`, b }));
      setRecents([...users, ...banks].slice(0, 4));
    })();
    return () => {
      active = false;
    };
  }, []);

  const canGo =
    (target.kind === 'user' && features.p2p_transfers) ||
    (target.kind === 'account' && features.ngn_withdrawals) ||
    (target.kind === 'phone' && features.bill_payments);

  function go(t: PayTarget = target) {
    if (t.kind === 'user') router.push({ pathname: '/(app)/send-user', params: { to: t.username } });
    else if (t.kind === 'account') router.push('/(app)/withdraw');
    else if (t.kind === 'phone') router.push({ pathname: '/(app)/bill/[service]', params: { service: 'airtime', customer: t.phone } });
  }

  function bill(service: string) {
    const customer = target.kind === 'meter' ? target.number : target.kind === 'phone' ? target.phone : undefined;
    router.push({ pathname: '/(app)/bill/[service]', params: customer ? { service, customer } : { service } });
  }

  const tile = { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border };

  return (
    <View className="flex-1" style={{ backgroundColor: colors.surface, paddingTop: insets.top }}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        <View className="flex-row items-center mb-6" style={{ gap: 12 }}>
          <TouchableOpacity
            onPress={() => router.back()}
            accessibilityLabel="Back"
            className="w-11 h-11 rounded-full items-center justify-center"
            style={tile}
          >
            <Ionicons name="chevron-back" size={20} color={colors.ink} />
          </TouchableOpacity>
          <Text style={{ color: colors.ink, fontSize: 24, fontWeight: '700', letterSpacing: -0.5 }}>Pay anyone</Text>
        </View>

        {/* The smart input — the screen's one accent while focused. */}
        <View
          style={{
            backgroundColor: colors.card,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: focused ? colors.brand : colors.border,
            paddingHorizontal: 16,
            paddingVertical: 12,
          }}
        >
          <CapsLabel>To</CapsLabel>
          <TextInput
            value={to}
            onChangeText={setTo}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onSubmitEditing={() => canGo && go()}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="@username or number"
            placeholderTextColor={colors.muted}
            style={{ color: colors.ink, fontSize: 26, lineHeight: 30, fontWeight: '800', marginTop: 4, padding: 0, fontVariant: ['tabular-nums'] }}
          />
        </View>
        <Text style={{ color: target.kind === 'unknown' ? '#F87171' : colors.muted, fontSize: 13, marginTop: 8, paddingHorizontal: 4 }}>
          {payTargetHint(target)}
        </Text>

        {recents.length > 0 && (
          <View className="mt-6">
            <CapsLabel style={{ marginBottom: 10 }}>Recent</CapsLabel>
            <View className="rounded-3xl overflow-hidden" style={[{ backgroundColor: colors.card }, cardEdge()]}>
              {recents.map((r, i) => (
                <TouchableOpacity
                  key={r.key}
                  activeOpacity={0.7}
                  onPress={() => (r.kind === 'user' ? go({ kind: 'user', username: r.username }) : router.push('/(app)/withdraw'))}
                  className="flex-row items-center pl-4"
                >
                  <View
                    className="w-11 h-11 rounded-full items-center justify-center"
                    style={{ backgroundColor: r.kind === 'user' ? '#D81E9B' : colors.circle }}
                  >
                    {r.kind === 'user' ? (
                      <Text style={{ color: '#fff', fontWeight: '800', fontSize: 17 }}>{r.username.charAt(0).toUpperCase()}</Text>
                    ) : (
                      <Ionicons name="business-outline" size={20} color={colors.ink} />
                    )}
                  </View>
                  <View
                    className="flex-1 ml-3 pr-4"
                    style={[{ paddingVertical: 14 }, i > 0 ? { borderTopWidth: 1, borderTopColor: colors.hairline } : null]}
                  >
                    <Text numberOfLines={1} style={{ color: colors.ink, fontSize: 15, fontWeight: '600' }}>
                      {r.kind === 'user' ? `@${r.username}` : r.b.accountName}
                    </Text>
                    <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 13, fontVariant: ['tabular-nums'] }}>
                      {r.kind === 'user' ? 'CheqPay user · arrives instantly' : `${r.b.bankName} · ${r.b.accountNumber} · your account`}
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {features.bill_payments && (
          <View className="mt-6">
            <CapsLabel style={{ marginBottom: 10 }}>Or pay a bill</CapsLabel>
            <View className="flex-row flex-wrap" style={{ gap: 10 }}>
              {[...BILLS, { service: '', label: 'All bills', icon: 'grid-outline' as const }].map((b) => (
                <TouchableOpacity
                  key={b.label}
                  activeOpacity={0.7}
                  onPress={() => (b.service ? bill(b.service) : router.push('/(app)/pay-bill'))}
                  className="items-center justify-center rounded-2xl"
                  style={[tile, { height: 72, flexBasis: '31%', flexGrow: 1, gap: 6 }]}
                >
                  <Ionicons name={b.icon} size={20} color={colors.ink} />
                  <Text style={{ color: colors.muted, fontSize: 13, fontWeight: '600' }}>{b.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* Secondary until the input says where the money goes. */}
        <TouchableOpacity
          onPress={() => go()}
          disabled={!canGo}
          activeOpacity={0.85}
          className="mt-6 rounded-full items-center justify-center"
          style={canGo ? { height: 54, backgroundColor: colors.brand } : [{ height: 54 }, tile]}
        >
          <Text style={{ color: canGo ? '#fff' : colors.muted, fontSize: 16, fontWeight: '700' }}>Continue</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}
