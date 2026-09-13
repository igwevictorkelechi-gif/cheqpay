import { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/components/brand';
import type { BillCashback, BillPlan } from '@/services/api';

/**
 * The data-bundle picker.
 *
 * A provider returns bundles in its own storage order, which buries the good
 * deals — so the API ranks them by naira-per-gigabyte and flags the strongest
 * ones. This renders that ranking: HOT leads with the best plan from each
 * duration (not just the cheapest per GB, which would be all monthly bundles
 * and nothing for someone who needs data today), and the category tabs let a
 * customer who knows what they want go straight there.
 *
 * Mirrors apps/web's DataPlanGrid so both apps present the same order; the
 * ranking itself lives on the server, not duplicated here. Every figure is one
 * we actually hold — live price, the cashback rate the award path pays, and a
 * bonus read from the provider's own bundle name.
 */

type Bucket = NonNullable<BillPlan['bucket']>;
type TabKey = Bucket | 'hot' | 'night';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'hot', label: 'HOT' },
  { key: 'night', label: 'Extra Night' },
  { key: 'daily', label: 'Daily' },
  { key: 'weekly', label: 'Weekly' },
  { key: 'monthly', label: 'Monthly' },
  { key: 'extended', label: '3-Month+' },
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

/** "250MB" -> ["250", "MB"], so the unit can be set smaller than the number. */
function splitSize(label: string | null | undefined): [string, string] {
  if (!label) return ['', ''];
  const m = /^([\d.]+)\s*([A-Za-z]+)$/.exec(label);
  return m ? [m[1], m[2]] : [label, ''];
}

function matches(p: BillPlan, tab: TabKey): boolean {
  if (tab === 'hot') return !!p.hot;
  if (tab === 'night') return !!p.night;
  return (p.bucket ?? 'other') === tab;
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
  const tabs = useMemo(() => TABS.filter((t) => plans.some((p) => matches(p, t.key))), [plans]);

  const [tab, setTab] = useState<TabKey>(() => tabs[0]?.key ?? 'hot');
  const [dense, setDense] = useState(true);

  const shown = useMemo(
    // The API already returns plans best-value first, so no re-sorting here.
    () => plans.filter((p) => matches(p, tab)),
    [plans, tab],
  );

  const cols = dense ? 3 : 2;
  const width = dense ? '31.5%' : '48%';
  // Pad the last row so three-up cards stay left-aligned instead of spreading.
  const fillers = (cols - (shown.length % cols)) % cols;

  if (plans.length === 0) {
    return (
      <View className="rounded-3xl p-5 mt-4" style={{ backgroundColor: colors.card }}>
        <Text className="text-muted dark:text-muted-dark text-sm">
          No plans available right now.
        </Text>
      </View>
    );
  }

  return (
    <View className="rounded-3xl p-4 mt-4" style={{ backgroundColor: colors.card }}>
      <View className="flex-row items-center justify-between mb-4">
        <Text className="text-ink dark:text-ink-dark font-extrabold" style={{ fontSize: 20 }}>
          Data Plans
        </Text>
        <View className="flex-row items-center">
          <TouchableOpacity
            onPress={() => setDense(true)}
            accessibilityLabel="Compact grid"
            className="mr-3"
            style={{ minHeight: 44, justifyContent: 'center' }}
          >
            <Ionicons name="grid" size={22} color={dense ? colors.brand : colors.muted} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setDense(false)}
            accessibilityLabel="Large grid"
            style={{ minHeight: 44, justifyContent: 'center' }}
          >
            <Ionicons
              name="apps"
              size={22}
              color={!dense ? colors.brand : colors.muted}
            />
          </TouchableOpacity>
        </View>
      </View>

      {/* Category tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        className="mb-4"
        contentContainerStyle={{ paddingRight: 16 }}
      >
        {tabs.map((t) => {
          const active = tab === t.key;
          return (
            <TouchableOpacity
              key={t.key}
              onPress={() => setTab(t.key)}
              activeOpacity={0.8}
              className="mr-6 pb-1.5"
              style={{
                minHeight: 44,
                justifyContent: 'flex-end',
                borderBottomWidth: 2,
                borderBottomColor: active ? colors.brand : 'transparent',
              }}
            >
              <Text
                className="font-bold"
                style={{ fontSize: 15, color: active ? colors.ink : colors.muted }}
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
          const [num, unit] = splitSize(p.sizeLabel);
          const footer = p.bonusLabel ?? (p.night ? 'Night Plan' : null);

          return (
            <TouchableOpacity
              key={p.id}
              onPress={() => onSelect(p.id)}
              activeOpacity={0.85}
              className="rounded-2xl mb-3 overflow-hidden"
              style={{
                width,
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: active ? colors.brand : colors.border,
              }}
            >
              {p.bestValue ? (
                <View
                  className="absolute right-0 top-0 px-1.5 py-0.5"
                  style={{ backgroundColor: colors.brand, borderBottomLeftRadius: 8, zIndex: 1 }}
                >
                  <Text className="text-white font-bold" style={{ fontSize: 8 }}>
                    BEST
                  </Text>
                </View>
              ) : null}

              <View className="px-2.5 pt-4 pb-2.5">
                <Text className="text-ink dark:text-ink-dark font-extrabold">
                  <Text style={{ fontSize: 22 }}>{num || p.name}</Text>
                  {unit ? <Text style={{ fontSize: 13 }}>{unit}</Text> : null}
                </Text>
                {p.validityLabel ? (
                  <Text className="text-muted dark:text-muted-dark text-sm mt-1.5">
                    {p.validityLabel}
                  </Text>
                ) : null}

                <Text className="text-ink dark:text-ink-dark text-base mt-2">
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
              </View>

              {footer ? (
                <View
                  className="flex-row items-center justify-between px-2.5 py-1"
                  style={{ backgroundColor: 'rgba(245,158,11,0.15)' }}
                >
                  <Text
                    numberOfLines={1}
                    className="font-semibold flex-1"
                    style={{ fontSize: 10, color: '#F59E0B' }}
                  >
                    {footer}
                  </Text>
                  <Ionicons name="information-circle" size={11} color="#F59E0B" />
                </View>
              ) : null}
            </TouchableOpacity>
          );
        })}

        {Array.from({ length: fillers }).map((_, i) => (
          <View key={`filler-${i}`} style={{ width }} />
        ))}
      </View>
    </View>
  );
}
