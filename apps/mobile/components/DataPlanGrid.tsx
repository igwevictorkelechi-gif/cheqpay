import { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { colors } from '@/components/brand';
import type { BillCashback, BillPlan } from '@/services/api';

/**
 * The data-bundle picker.
 *
 * A provider returns bundles in its own storage order, which buries the good
 * deals — so the API ranks them by naira-per-gigabyte and flags the strongest
 * ones. This renders that ranking: "Best deals" leads with the best plan from
 * each duration (not just the cheapest per GB, which would be all monthly
 * bundles and nothing for someone who needs data today), and the duration tabs
 * let a customer who knows what they want go straight there.
 *
 * Mirrors apps/web's DataPlanGrid so both apps present the same order; the
 * ranking itself lives on the server, not duplicated here.
 */

type Bucket = NonNullable<BillPlan['bucket']>;

const TAB_LABELS: { key: Bucket | 'hot'; label: string }[] = [
  { key: 'hot', label: 'Best deals' },
  { key: 'daily', label: 'Daily' },
  { key: 'weekly', label: 'Weekly' },
  { key: 'monthly', label: 'Monthly' },
  { key: 'extended', label: 'Extended' },
  { key: 'other', label: 'Other' },
];

/** What this plan actually earns back, using the live rate. Null when off. */
function cashbackNaira(amount: string, cb?: BillCashback): number | null {
  if (!cb?.enabled || cb.billBps <= 0) return null;
  const naira = Number(amount);
  if (!Number.isFinite(naira) || naira <= 0) return null;
  let reward = (naira * cb.billBps) / 10_000;
  if (cb.maxNgn > 0) reward = Math.min(reward, cb.maxNgn);
  if (reward <= 0) return null;
  // Match the ledger: kobo precision, floored, never rounded up.
  return Math.floor(reward * 100) / 100;
}

function money(n: number): string {
  return n.toLocaleString('en-NG', {
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

export default function DataPlanGrid({
  plans,
  selectedId,
  onSelect,
  cashback,
}: {
  plans: BillPlan[];
  selectedId: string;
  onSelect: (id: string) => void;
  cashback?: BillCashback;
}) {
  // Only offer tabs that actually hold something, so there are no dead tabs.
  const tabs = useMemo(() => {
    const present = new Set(plans.map((p) => p.bucket ?? 'other'));
    return TAB_LABELS.filter((t) =>
      t.key === 'hot' ? plans.some((p) => p.hot) : present.has(t.key as Bucket),
    );
  }, [plans]);

  const [tab, setTab] = useState<Bucket | 'hot'>(() =>
    plans.some((p) => p.hot) ? 'hot' : ((plans[0]?.bucket ?? 'other') as Bucket),
  );

  const shown = useMemo(() => {
    // The API already returns plans best-value first, so no re-sorting here.
    if (tab === 'hot') return plans.filter((p) => p.hot);
    return plans.filter((p) => (p.bucket ?? 'other') === tab);
  }, [plans, tab]);

  if (plans.length === 0) {
    return (
      <Text className="text-muted dark:text-muted-dark text-sm mt-4">
        No plans available right now.
      </Text>
    );
  }

  return (
    <View className="mt-6">
      <Text className="text-muted dark:text-muted-dark text-sm font-semibold mb-3">
        Data plans
      </Text>

      {/* Duration tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        className="mb-4"
        contentContainerStyle={{ paddingRight: 20 }}
      >
        {tabs.map((t) => {
          const active = tab === t.key;
          return (
            <TouchableOpacity
              key={t.key}
              onPress={() => setTab(t.key)}
              activeOpacity={0.8}
              className="mr-5 pb-2"
              style={{
                minHeight: 44,
                justifyContent: 'flex-end',
                borderBottomWidth: 2,
                borderBottomColor: active ? colors.brand : 'transparent',
              }}
            >
              <Text
                className="text-sm font-bold"
                style={{ color: active ? colors.ink : colors.muted }}
              >
                {t.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <View className="flex-row flex-wrap justify-between">
        {shown.map((p) => {
          const cb = cashbackNaira(p.amount, cashback);
          const active = selectedId === p.id;
          return (
            <TouchableOpacity
              key={p.id}
              onPress={() => onSelect(p.id)}
              activeOpacity={0.85}
              className="rounded-2xl p-3 mb-3"
              style={{
                width: '48%',
                minHeight: 112,
                backgroundColor: colors.card,
                borderWidth: 1,
                borderColor: active ? colors.brand : colors.border,
              }}
            >
              {p.bestValue ? (
                <View
                  className="rounded-full px-2 py-0.5 self-start mb-1"
                  style={{ backgroundColor: colors.brand }}
                >
                  <Text className="text-white font-bold" style={{ fontSize: 9 }}>
                    BEST VALUE
                  </Text>
                </View>
              ) : null}

              <Text
                className="text-ink dark:text-ink-dark font-extrabold"
                style={{ fontSize: 20 }}
              >
                {p.sizeLabel ?? p.name}
              </Text>
              {p.validityLabel ? (
                <Text className="text-muted dark:text-muted-dark text-xs mt-0.5">
                  {p.validityLabel}
                </Text>
              ) : null}

              <Text className="text-ink dark:text-ink-dark font-bold text-base mt-auto pt-2">
                ₦{money(Number(p.amount))}
              </Text>

              {cb !== null ? (
                <Text className="text-xs font-semibold" style={{ color: colors.brand }}>
                  ₦{money(cb)} Cashback
                </Text>
              ) : null}
              {p.nairaPerGb !== null && p.nairaPerGb !== undefined ? (
                <Text className="text-muted dark:text-muted-dark" style={{ fontSize: 10 }}>
                  ₦{money(Math.round(p.nairaPerGb))}/GB
                </Text>
              ) : null}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}
