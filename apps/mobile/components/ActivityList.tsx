import { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { TxnRow, txnAmount } from '@/components/TxnRow';
import { colors, CapsLabel, cardEdge } from '@/components/brand';
import type { LedgerTransaction } from '@/services/api';

type Filter = 'all' | 'in' | 'out' | 'pending';
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'in', label: 'Money in' },
  { key: 'out', label: 'Money out' },
  { key: 'pending', label: 'Pending' },
];

const inFlight = (t: LedgerTransaction) => t.status === 'PENDING' || t.status === 'PROCESSING';

function matches(t: LedgerTransaction, f: Filter): boolean {
  if (f === 'all') return true;
  if (f === 'pending') return inFlight(t);
  const positive = txnAmount(t).positive;
  return f === 'in' ? positive : !positive;
}

/** "Today", "Yesterday", or "Mon 16 Nov", in Lagos time. */
function dayLabel(iso: string, now: Date): string {
  const key = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' });
  const d = new Date(iso);
  if (key(d) === key(now)) return 'Today';
  if (key(d) === key(new Date(now.getTime() - 86_400_000))) return 'Yesterday';
  return d.toLocaleDateString('en-NG', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Africa/Lagos' });
}

const open = (t: LedgerTransaction) => router.push(`/(app)/transaction/${t.id}`);

/**
 * v2 Activity: filter chips, then one card per day under a caps date header.
 * A withdrawal still on its way gets its own card with a three-step timeline;
 * the active step is the screen's one brand accent.
 */
export default function ActivityList({ txns }: { txns: LedgerTransaction[] }) {
  const [filter, setFilter] = useState<Filter>('all');

  const groups = useMemo(() => {
    const now = new Date();
    const out: { label: string; live: LedgerTransaction[]; rest: LedgerTransaction[] }[] = [];
    for (const t of txns.filter((x) => matches(x, filter))) {
      const label = dayLabel(t.createdAt, now);
      let g = out[out.length - 1];
      if (!g || g.label !== label) out.push((g = { label, live: [], rest: [] }));
      (t.type === 'WITHDRAWAL' && inFlight(t) ? g.live : g.rest).push(t);
    }
    return out;
  }, [txns, filter]);

  const card = [{ backgroundColor: colors.card, borderRadius: 24, overflow: 'hidden' as const }, cardEdge()];

  return (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 8 }}>
        {FILTERS.map((f) => {
          const on = filter === f.key;
          return (
            <TouchableOpacity
              key={f.key}
              onPress={() => setFilter(f.key)}
              accessibilityState={{ selected: on }}
              className="rounded-full px-4 justify-center"
              style={{ height: 36, backgroundColor: on ? colors.ink : colors.card }}
            >
              <Text style={{ color: on ? colors.surface : colors.muted, fontSize: 13, fontWeight: '600' }}>{f.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {groups.length === 0 ? (
        <Text style={{ color: colors.muted, textAlign: 'center', paddingVertical: 48 }}>Nothing here.</Text>
      ) : (
        groups.map((g) => (
          <View key={g.label} style={{ marginTop: 16 }}>
            <CapsLabel style={{ marginBottom: 10 }}>{g.label}</CapsLabel>
            {g.live.map((t) => (
              <View key={t.id} style={[...card, { marginBottom: 12 }]}>
                <TxnRow t={t} onPress={() => open(t)} />
                <WithdrawalTimeline t={t} />
              </View>
            ))}
            {g.rest.length > 0 && (
              <View style={card}>
                {g.rest.map((t, i) => (
                  <TxnRow key={t.id} t={t} divider={i > 0} onPress={() => open(t)} />
                ))}
              </View>
            )}
          </View>
        ))
      )}
    </View>
  );
}

/** Left your wallet ✓ → With the bank ◉ → In your bank account ○ */
function WithdrawalTimeline({ t }: { t: LedgerTransaction }) {
  const at = new Date(t.createdAt).toLocaleTimeString('en-NG', { hour: 'numeric', minute: '2-digit', timeZone: 'Africa/Lagos' });
  const steps = [
    { state: 'done', title: 'Left your wallet', meta: at },
    { state: 'active', title: 'With the bank', meta: 'Now · crediting the account' },
    { state: 'todo', title: 'In your bank account', meta: 'Usually under 2 min' },
  ] as const;
  return (
    <View style={{ paddingLeft: 68, paddingRight: 16, paddingBottom: 16 }}>
      {steps.map((s, i) => (
        <View key={s.title} style={{ flexDirection: 'row', gap: 12, paddingBottom: i < steps.length - 1 ? 12 : 0 }}>
          {i < steps.length - 1 && (
            <View style={{ position: 'absolute', left: 9, top: 24, bottom: 0, width: 2, backgroundColor: colors.hairline }} />
          )}
          <View
            style={{
              width: 20,
              height: 20,
              borderRadius: 10,
              marginTop: 2,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: s.state === 'done' ? 'rgba(52,199,89,0.2)' : s.state === 'active' ? 'rgba(107,91,149,0.2)' : 'transparent',
              borderWidth: s.state === 'done' ? 0 : 2,
              borderColor: s.state === 'active' ? colors.brand : colors.border,
            }}
          >
            {s.state === 'done' && <Ionicons name="checkmark" size={13} color={colors.positive} />}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: s.state === 'todo' ? colors.muted : colors.ink, fontSize: 15, fontWeight: '600' }}>{s.title}</Text>
            <Text style={{ color: colors.muted, fontSize: 13 }}>{s.meta}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}
