import { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, Alert, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { colors } from '@/components/brand';
import { useTransactionPin, PIN_CANCELLED } from '@/components/TransactionPinProvider';
import { api, ApiError, type AjoGroup, type AjoOverview, type AjoPlan } from '@/services/api';
import { dueLabel, every, ngn, planPct, shortDate, splitGoal } from '@/lib/ajo';

const GROUP_STATUS: Record<AjoGroup['status'], { label: string; color: string }> = {
  forming: { label: 'Gathering people', color: '#FBBF24' },
  active: { label: 'Running', color: '#34D399' },
  completed: { label: 'Done', color: colors.muted },
  cancelled: { label: 'Cancelled', color: colors.muted },
};

/** One dot per contribution: saved, missed, still to come. Long plans get a bar instead. */
function StreakTrack({ paid, missed, total }: { paid: number; missed: number; total: number }) {
  if (total > 40) {
    const pct = Math.min(100, Math.round(((paid + missed) / Math.max(1, total)) * 100));
    return (
      <View className="h-2 rounded-full" style={{ backgroundColor: colors.border }}>
        <View className="h-2 rounded-full" style={{ width: `${pct}%`, backgroundColor: colors.brand }} />
      </View>
    );
  }
  const dots = Array.from({ length: total }, (_, i) => (i < paid ? 'paid' : i < paid + missed ? 'missed' : 'next'));
  return (
    <View className="flex-row flex-wrap" style={{ gap: 6 }}>
      {dots.map((d, i) => (
        <View
          key={i}
          style={{
            width: 10,
            height: 10,
            borderRadius: 5,
            backgroundColor: d === 'paid' ? colors.brand : d === 'missed' ? 'rgba(248,113,113,0.5)' : colors.border,
          }}
        />
      ))}
    </View>
  );
}

/**
 * Ajo home: the user's savings plans and their group circles, with a banner
 * while they owe a group (the lien: new money goes to the group first, and
 * withdrawals and transfers wait until they're caught up).
 */
export default function AjoScreen() {
  const insets = useSafeAreaInsets();
  const { authorize } = useTransactionPin();
  const { code } = useLocalSearchParams<{ code?: string }>();
  const [data, setData] = useState<AjoOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // An invite link (mycheqpay.com/ajo?code=…) lands here: go straight to joining.
  useEffect(() => {
    if (code) router.push({ pathname: '/(app)/ajo-group-new', params: { code: String(code) } });
  }, [code]);

  const load = useCallback(async () => {
    try {
      setData(await api.getAjo());
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Couldn’t load Ajo. Pull down to try again.');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  function confirmBreak(p: AjoPlan) {
    const fee = data?.rules.breakFeePercent ?? 0;
    const { label } = splitGoal(p.name);
    Alert.alert(
      `End “${label}” early?`,
      `${ngn(p.saved)} comes back to your wallet${fee > 0 ? `, minus a ${fee}% break fee` : ''}. Plans that run to the end are free, and you’re ${planPct(p)}% there.`,
      [
        { text: 'Keep going', style: 'cancel' },
        {
          text: 'End plan',
          style: 'destructive',
          onPress: async () => {
            try {
              const r = await authorize((pin) => api.breakAjoPlan(p.id, pin), {
                title: 'End Ajo plan',
                detail: `Enter your transaction PIN to end “${label}”.`,
              });
              Alert.alert('Plan ended', `${ngn(r.returned)} is back in your wallet.`);
              load();
            } catch (e) {
              if (e instanceof Error && e.message === PIN_CANCELLED) return;
              Alert.alert('Couldn’t end the plan', e instanceof ApiError ? e.message : 'Please try again.');
            }
          },
        },
      ],
    );
  }

  const Header = (
    <View className="flex-row items-center px-5 pt-3 pb-2">
      <TouchableOpacity
        onPress={() => router.back()}
        className="w-10 h-10 rounded-full bg-card dark:bg-card-dark items-center justify-center"
      >
        <Ionicons name="chevron-back" size={22} color={colors.ink} />
      </TouchableOpacity>
      <Text className="text-ink dark:text-ink-dark text-lg font-bold ml-3">Ajo</Text>
    </View>
  );

  if (!data) {
    return (
      <View className="flex-1" style={{ backgroundColor: colors.surface, paddingTop: insets.top }}>
        {Header}
        {error ? (
          <Text className="text-muted dark:text-muted-dark text-sm px-5 mt-4">{error}</Text>
        ) : (
          <ActivityIndicator color={colors.brand} style={{ marginTop: 32 }} />
        )}
      </View>
    );
  }

  const active = data.plans.filter((p) => p.status === 'active');
  const ended = data.plans.filter((p) => p.status !== 'active').slice(0, 5);
  const savedNow = active.reduce((s, p) => s + Number(p.saved), 0);
  const goalTotal = active.reduce((s, p) => s + Number(p.target), 0);
  const liveGroups = data.groups.filter((g) => g.status === 'active' || g.status === 'forming');
  const nextDue = [...active.map((p) => p.nextDueAt), ...liveGroups.map((g) => g.nextDueAt)]
    .filter((d): d is string => Boolean(d))
    .sort()[0];
  const empty = active.length === 0 && data.groups.length === 0;

  return (
    <View className="flex-1" style={{ backgroundColor: colors.surface, paddingTop: insets.top }}>
      {Header}
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 40 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={colors.brand}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
          />
        }
      >
        {data.inArrears && (
          <View className="mt-2 px-4 py-4 rounded-3xl" style={{ backgroundColor: 'rgba(248,113,113,0.12)' }}>
            <Text style={{ color: '#F87171', fontWeight: '700' }}>You owe your group {ngn(data.arrears)}</Text>
            <Text className="text-muted dark:text-muted-dark text-xs mt-1">
              Money you add goes to them first. Withdrawals, transfers and purchases open again the moment you’re
              caught up.
            </Text>
            <TouchableOpacity
              onPress={() => router.push('/(app)/deposit')}
              className="mt-3 self-start px-4 py-2 rounded-full"
              style={{ backgroundColor: '#F87171' }}
            >
              <Text style={{ color: colors.white, fontWeight: '700', fontSize: 13 }}>Add money</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Hero */}
        <View className="mt-3 px-5 py-5 rounded-3xl" style={{ backgroundColor: colors.brand }}>
          <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 13 }}>
            {empty ? 'Saving, but make it automatic' : 'Locked away so far'}
          </Text>
          <Text style={{ color: colors.white, fontSize: 32, fontWeight: '800', marginTop: 2 }}>{ngn(savedNow)}</Text>
          {goalTotal > 0 && (
            <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12, marginTop: 4 }}>
              {Math.round((savedNow / goalTotal) * 100)}% of {ngn(goalTotal)} across {active.length}{' '}
              {active.length === 1 ? 'plan' : 'plans'}
            </Text>
          )}
          <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 12, marginTop: 8 }}>
            {nextDue
              ? `Next auto-save: ${dueLabel(nextDue)}. You don’t have to remember a thing.`
              : 'Pick an amount and a rhythm. We take it from your wallet on the day, every time.'}
          </Text>
        </View>

        <View className="flex-row mt-4" style={{ gap: 10 }}>
          <TouchableOpacity
            onPress={() => router.push('/(app)/ajo-plan-new')}
            className="flex-1 py-4 rounded-3xl items-center"
            style={{ backgroundColor: colors.card }}
          >
            <Text style={{ fontSize: 24 }}>🐷</Text>
            <Text className="text-ink dark:text-ink-dark font-semibold mt-1">Solo plan</Text>
            <Text className="text-muted dark:text-muted-dark text-xs">Save towards a goal</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => router.push('/(app)/ajo-group-new')}
            className="flex-1 py-4 rounded-3xl items-center"
            style={{ backgroundColor: colors.card }}
          >
            <Text style={{ fontSize: 24 }}>🤝</Text>
            <Text className="text-ink dark:text-ink-dark font-semibold mt-1">Group Ajo</Text>
            <Text className="text-muted dark:text-muted-dark text-xs">Save with your people</Text>
          </TouchableOpacity>
        </View>

        {/* Plans */}
        <Text className="text-muted dark:text-muted-dark text-sm font-semibold mt-7 mb-2">My plans</Text>
        {active.length === 0 ? (
          <TouchableOpacity
            onPress={() => router.push('/(app)/ajo-plan-new')}
            className="px-4 py-5 rounded-3xl flex-row items-center"
            style={{ backgroundColor: colors.card }}
          >
            <Text style={{ fontSize: 28 }}>🎯</Text>
            <View className="ml-3 flex-1">
              <Text className="text-ink dark:text-ink-dark font-semibold">Name a goal, pick a rhythm</Text>
              <Text className="text-muted dark:text-muted-dark text-xs mt-0.5">
                ₦500 a day is ₦15,000 by the end of the month. It all comes back, free, when the plan ends.
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.muted} />
          </TouchableOpacity>
        ) : (
          active.map((p) => {
            const { emoji, label } = splitGoal(p.name);
            const pct = planPct(p);
            const left = Number(p.target) - Number(p.saved);
            return (
              <View key={p.id} className="px-4 py-4 rounded-3xl mb-3" style={{ backgroundColor: colors.card }}>
                <View className="flex-row items-center">
                  <View
                    className="w-11 h-11 rounded-2xl items-center justify-center"
                    style={{ backgroundColor: colors.circle }}
                  >
                    <Text style={{ fontSize: 22 }}>{emoji}</Text>
                  </View>
                  <View className="ml-3 flex-1">
                    <Text className="text-ink dark:text-ink-dark font-bold text-base" numberOfLines={1}>
                      {label}
                    </Text>
                    <Text className="text-muted dark:text-muted-dark text-xs mt-0.5">
                      {ngn(p.amount)} every {every[p.frequency]} · {dueLabel(p.nextDueAt)}
                    </Text>
                  </View>
                  <View className="items-end">
                    <Text className="text-ink dark:text-ink-dark font-bold">{ngn(p.saved)}</Text>
                    <Text style={{ color: colors.brandLight, fontSize: 12, fontWeight: '700' }}>{pct}% there</Text>
                  </View>
                </View>
                <View className="mt-3">
                  <StreakTrack paid={p.paidCount} missed={p.missedCount} total={p.totalCount} />
                </View>
                <View className="flex-row justify-between items-center mt-3">
                  <Text className="text-muted dark:text-muted-dark text-xs">
                    {p.paidCount} saved{p.missedCount > 0 ? ` · ${p.missedCount} missed` : ''} ·{' '}
                    {left > 0 ? `${ngn(left)} to go` : 'goal reached'}
                  </Text>
                  <TouchableOpacity onPress={() => confirmBreak(p)} hitSlop={8}>
                    <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '600' }}>End early</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })
        )}

        {/* Groups */}
        <Text className="text-muted dark:text-muted-dark text-sm font-semibold mt-5 mb-2">My groups</Text>
        {data.groups.length === 0 ? (
          <TouchableOpacity
            onPress={() => router.push('/(app)/ajo-group-new')}
            className="px-4 py-5 rounded-3xl flex-row items-center"
            style={{ backgroundColor: colors.card }}
          >
            <Text style={{ fontSize: 28 }}>🫂</Text>
            <View className="ml-3 flex-1">
              <Text className="text-ink dark:text-ink-dark font-semibold">Start one with your people</Text>
              <Text className="text-muted dark:text-muted-dark text-xs mt-0.5">
                Everyone pays in each round. One person collects the whole pot, until everyone has had a turn.
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.muted} />
          </TouchableOpacity>
        ) : (
          data.groups.map((g) => {
            const mine = g.myPosition !== null && g.status === 'active';
            const myTurn = mine && g.myPosition === g.currentRound;
            return (
              <TouchableOpacity
                key={g.id}
                onPress={() => router.push({ pathname: '/(app)/ajo-group/[id]', params: { id: g.id } })}
                className="px-4 py-4 rounded-3xl mb-3"
                style={{
                  backgroundColor: colors.card,
                  borderWidth: myTurn ? 1 : 0,
                  borderColor: myTurn ? colors.brandLight : 'transparent',
                }}
              >
                <View className="flex-row justify-between items-center">
                  <Text className="text-ink dark:text-ink-dark font-bold text-base flex-1" numberOfLines={1}>
                    {g.name}
                  </Text>
                  <Text style={{ color: GROUP_STATUS[g.status].color, fontSize: 12, fontWeight: '700' }}>
                    {GROUP_STATUS[g.status].label}
                  </Text>
                </View>
                <Text className="text-muted dark:text-muted-dark text-xs mt-0.5">
                  {ngn(g.amount)} every {every[g.frequency]} · pot {ngn(g.pot)}
                  {g.status === 'forming' ? ` · ${g.members ?? 1}/${g.size} in` : ''}
                  {g.status === 'active' ? ` · round ${g.currentRound} of ${g.size}` : ''}
                </Text>
                {g.status === 'active' && (
                  <View className="flex-row items-center mt-2.5">
                    <View
                      className="px-2.5 py-1 rounded-full"
                      style={{ backgroundColor: myTurn ? colors.brand : colors.circle }}
                    >
                      <Text style={{ color: myTurn ? colors.white : colors.ink, fontSize: 11, fontWeight: '700' }}>
                        {myTurn
                          ? `Your turn · ${dueLabel(g.nextDueAt)}`
                          : mine && (g.myPosition as number) > g.currentRound
                            ? `You collect in round ${g.myPosition}`
                            : 'You’ve collected'}
                      </Text>
                    </View>
                    {!myTurn && (
                      <Text className="text-muted dark:text-muted-dark text-xs ml-2">
                        Next: {dueLabel(g.nextDueAt)}
                      </Text>
                    )}
                  </View>
                )}
                {g.status === 'forming' && g.isOrganiser && (
                  <Text style={{ color: colors.brandLight, fontSize: 12, fontWeight: '600', marginTop: 8 }}>
                    Share the code · {g.inviteCode}
                  </Text>
                )}
              </TouchableOpacity>
            );
          })
        )}

        {ended.length > 0 && (
          <>
            <Text className="text-muted dark:text-muted-dark text-sm font-semibold mt-5 mb-2">Finished</Text>
            <View className="rounded-3xl overflow-hidden" style={{ backgroundColor: colors.card }}>
              {ended.map((p, i) => (
                <View
                  key={p.id}
                  className="flex-row items-center px-4 py-3"
                  style={i > 0 ? { borderTopWidth: 1, borderTopColor: colors.border } : undefined}
                >
                  <Text style={{ fontSize: 18 }}>{splitGoal(p.name).emoji}</Text>
                  <Text className="text-ink dark:text-ink-dark ml-2 flex-1" numberOfLines={1}>
                    {splitGoal(p.name).label}
                  </Text>
                  <Text className="text-muted dark:text-muted-dark text-xs">
                    {p.status === 'matured' ? `Completed 🎉` : 'Ended early'} · {shortDate(p.closedAt)}
                  </Text>
                </View>
              ))}
            </View>
          </>
        )}

        <Text className="text-muted dark:text-muted-dark text-xs mt-8 text-center">
          No interest, no fine print. Finished plans come back in full.{'\n'}
          Ending early keeps a {data.rules.breakFeePercent}% fee.
        </Text>
      </ScrollView>
    </View>
  );
}
