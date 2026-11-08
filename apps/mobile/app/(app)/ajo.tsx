import { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, Alert, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { colors } from '@/components/brand';
import { useTransactionPin, PIN_CANCELLED } from '@/components/TransactionPinProvider';
import { api, ApiError, type AjoGroup, type AjoOverview, type AjoPlan } from '@/services/api';
import { every, ngn, shortDate } from '@/lib/ajo';

const GROUP_STATUS: Record<AjoGroup['status'], { label: string; color: string }> = {
  forming: { label: 'Gathering members', color: '#FBBF24' },
  active: { label: 'Running', color: '#34D399' },
  completed: { label: 'Completed', color: colors.muted },
  cancelled: { label: 'Cancelled', color: colors.muted },
};

/**
 * Ajo home: the user's personal savings plans and their group circles, plus a
 * banner while they owe a group (the lien: new money goes to the group first,
 * and withdrawals and transfers wait until they're caught up).
 */
export default function AjoScreen() {
  const insets = useSafeAreaInsets();
  const { authorize } = useTransactionPin();
  const [data, setData] = useState<AjoOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

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
    Alert.alert(
      'End this plan early?',
      `${ngn(p.saved)} goes back to your wallet${fee > 0 ? `, minus a ${fee}% break fee` : ''}. Plans that run to the end are free.`,
      [
        { text: 'Keep saving', style: 'cancel' },
        {
          text: 'End plan',
          style: 'destructive',
          onPress: async () => {
            try {
              const r = await authorize((pin) => api.breakAjoPlan(p.id, pin), {
                title: 'End Ajo plan',
                detail: `Enter your transaction PIN to end “${p.name}”.`,
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
      <Text className="text-ink dark:text-ink-dark text-lg font-bold ml-3">Ajo savings</Text>
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
            <Text style={{ color: '#F87171', fontWeight: '700' }}>You owe {ngn(data.arrears)} to your Ajo group</Text>
            <Text className="text-muted dark:text-muted-dark text-xs mt-1">
              Money you add goes to your group first. Withdrawals, transfers and purchases open again as soon as you’re
              caught up.
            </Text>
            <TouchableOpacity onPress={() => router.push('/(app)/deposit')} className="mt-3">
              <Text style={{ color: colors.brandLight, fontWeight: '700' }}>Add money</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Summary */}
        <View className="mt-3 px-5 py-5 rounded-3xl" style={{ backgroundColor: colors.brand }}>
          <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 13 }}>Saved in your plans</Text>
          <Text style={{ color: colors.white, fontSize: 30, fontWeight: '800', marginTop: 2 }}>{ngn(savedNow)}</Text>
          <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 12, marginTop: 6 }}>
            Taken automatically at {data.rules.dueTime} on each due date.
          </Text>
        </View>

        <View className="flex-row mt-4" style={{ gap: 10 }}>
          <TouchableOpacity
            onPress={() => router.push('/(app)/ajo-plan-new')}
            className="flex-1 py-4 rounded-3xl items-center"
            style={{ backgroundColor: colors.card }}
          >
            <Ionicons name="wallet-outline" size={22} color={colors.brandLight} />
            <Text className="text-ink dark:text-ink-dark font-semibold mt-1">New plan</Text>
            <Text className="text-muted dark:text-muted-dark text-xs">Just me</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => router.push('/(app)/ajo-group-new')}
            className="flex-1 py-4 rounded-3xl items-center"
            style={{ backgroundColor: colors.card }}
          >
            <Ionicons name="people-outline" size={22} color={colors.brandLight} />
            <Text className="text-ink dark:text-ink-dark font-semibold mt-1">Group Ajo</Text>
            <Text className="text-muted dark:text-muted-dark text-xs">Start or join</Text>
          </TouchableOpacity>
        </View>

        {/* Plans */}
        <Text className="text-muted dark:text-muted-dark text-sm font-semibold mt-7 mb-2">My plans</Text>
        {active.length === 0 ? (
          <View className="px-4 py-5 rounded-3xl" style={{ backgroundColor: colors.card }}>
            <Text className="text-muted dark:text-muted-dark text-sm">
              Pick an amount and how often. We save it for you, and it all comes back when the plan ends.
            </Text>
          </View>
        ) : (
          active.map((p) => {
            const done = p.paidCount + p.missedCount;
            const pct = Math.min(100, Math.round((Number(p.saved) / Math.max(1, Number(p.target))) * 100));
            return (
              <View key={p.id} className="px-4 py-4 rounded-3xl mb-3" style={{ backgroundColor: colors.card }}>
                <View className="flex-row justify-between items-center">
                  <Text className="text-ink dark:text-ink-dark font-bold text-base">{p.name}</Text>
                  <Text className="text-ink dark:text-ink-dark font-bold">{ngn(p.saved)}</Text>
                </View>
                <Text className="text-muted dark:text-muted-dark text-xs mt-0.5">
                  {ngn(p.amount)} every {every[p.frequency]} · {done} of {p.totalCount}
                  {p.missedCount > 0 ? ` · ${p.missedCount} missed` : ''}
                </Text>
                <View className="h-2 rounded-full mt-3" style={{ backgroundColor: colors.border }}>
                  <View className="h-2 rounded-full" style={{ width: `${pct}%`, backgroundColor: colors.brand }} />
                </View>
                <View className="flex-row justify-between items-center mt-3">
                  <Text className="text-muted dark:text-muted-dark text-xs">
                    {p.nextDueAt ? `Next: ${shortDate(p.nextDueAt)}` : ''} · Goal {ngn(p.target)}
                  </Text>
                  <TouchableOpacity onPress={() => confirmBreak(p)}>
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
          <View className="px-4 py-5 rounded-3xl" style={{ backgroundColor: colors.card }}>
            <Text className="text-muted dark:text-muted-dark text-sm">
              Save with people you trust. Everyone pays in each round and one person collects the whole pot, until
              everyone has had a turn.
            </Text>
          </View>
        ) : (
          data.groups.map((g) => (
            <TouchableOpacity
              key={g.id}
              onPress={() => router.push({ pathname: '/(app)/ajo-group/[id]', params: { id: g.id } })}
              className="px-4 py-4 rounded-3xl mb-3"
              style={{ backgroundColor: colors.card }}
            >
              <View className="flex-row justify-between items-center">
                <Text className="text-ink dark:text-ink-dark font-bold text-base">{g.name}</Text>
                <Text style={{ color: GROUP_STATUS[g.status].color, fontSize: 12, fontWeight: '700' }}>
                  {GROUP_STATUS[g.status].label}
                </Text>
              </View>
              <Text className="text-muted dark:text-muted-dark text-xs mt-0.5">
                {ngn(g.amount)} every {every[g.frequency]} · pot {ngn(g.pot)}
                {g.status === 'forming' ? ` · ${g.members ?? 1}/${g.size} joined` : ''}
                {g.status === 'active' ? ` · round ${g.currentRound} of ${g.size}` : ''}
              </Text>
              {g.myPosition && g.status === 'active' && (
                <Text className="text-ink dark:text-ink-dark text-xs mt-2">
                  {g.myPosition === g.currentRound
                    ? 'You collect this round'
                    : g.myPosition > g.currentRound
                      ? `You collect in round ${g.myPosition}`
                      : 'You’ve collected'}
                </Text>
              )}
            </TouchableOpacity>
          ))
        )}

        {ended.length > 0 && (
          <>
            <Text className="text-muted dark:text-muted-dark text-sm font-semibold mt-5 mb-2">Finished plans</Text>
            <View className="rounded-3xl overflow-hidden" style={{ backgroundColor: colors.card }}>
              {ended.map((p, i) => (
                <View
                  key={p.id}
                  className="flex-row justify-between px-4 py-3"
                  style={i > 0 ? { borderTopWidth: 1, borderTopColor: colors.border } : undefined}
                >
                  <Text className="text-ink dark:text-ink-dark">{p.name}</Text>
                  <Text className="text-muted dark:text-muted-dark text-xs">
                    {p.status === 'matured' ? 'Completed' : 'Ended early'} · {shortDate(p.closedAt)}
                  </Text>
                </View>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}
