import { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, Alert, Share, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { colors } from '@/components/brand';
import { api, ApiError, type AjoGroupDetail } from '@/services/api';
import { every, ngn, shortDate } from '@/lib/ajo';

/**
 * One Ajo group: the invite code while it's gathering members, the collecting
 * order, who is behind, and what each round paid out.
 */
export default function AjoGroupScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [data, setData] = useState<AjoGroupDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api.getAjoGroup(String(id)));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Couldn’t load this group.');
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  function act(action: 'start' | 'leave' | 'cancel') {
    const g = data?.group;
    if (!g) return;
    const copy = {
      start: {
        title: 'Start the group?',
        body: `${data.members.length} members. ${
          g.payoutOrder === 'random' ? 'The collecting order is drawn now.' : 'People collect in the order they joined.'
        } Nobody else can join after this.`,
        ok: 'Start',
      },
      leave: { title: 'Leave this group?', body: 'You can join again with the code while it’s still gathering members.', ok: 'Leave' },
      cancel: { title: 'Cancel this group?', body: 'Nobody has paid anything yet. This can’t be undone.', ok: 'Cancel group' },
    }[action];
    Alert.alert(copy.title, copy.body, [
      { text: 'Not now', style: 'cancel' },
      {
        text: copy.ok,
        style: action === 'start' ? 'default' : 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            await api.ajoGroupAction(g.id, action);
            if (action === 'start') load();
            else router.back();
          } catch (e) {
            Alert.alert('Couldn’t do that', e instanceof ApiError ? e.message : 'Please try again.');
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  }

  const Header = (
    <View className="flex-row items-center px-5 pt-3 pb-2">
      <TouchableOpacity
        onPress={() => router.back()}
        className="w-10 h-10 rounded-full bg-card dark:bg-card-dark items-center justify-center"
      >
        <Ionicons name="chevron-back" size={22} color={colors.ink} />
      </TouchableOpacity>
      <Text className="text-ink dark:text-ink-dark text-lg font-bold ml-3" numberOfLines={1}>
        {data?.group.name ?? 'Ajo group'}
      </Text>
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

  const g = data.group;
  const forming = g.status === 'forming';
  const ordered = [...data.members].sort((a, b) => (a.position ?? 99) - (b.position ?? 99));

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
        {/* Summary */}
        <View className="mt-2 px-5 py-5 rounded-3xl" style={{ backgroundColor: colors.brand }}>
          <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 13 }}>Pot each round</Text>
          <Text style={{ color: colors.white, fontSize: 30, fontWeight: '800', marginTop: 2 }}>{ngn(g.pot)}</Text>
          <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 12, marginTop: 6 }}>
            {ngn(g.amount)} each, every {every[g.frequency]} · {g.size} members
          </Text>
          {g.status === 'active' && (
            <Text style={{ color: colors.white, fontSize: 13, fontWeight: '700', marginTop: 10 }}>
              Round {g.currentRound} of {g.size} · next contribution {shortDate(g.nextDueAt)}, 9am
            </Text>
          )}
          {g.status === 'completed' && (
            <Text style={{ color: colors.white, fontSize: 13, fontWeight: '700', marginTop: 10 }}>
              Completed. Everyone has collected.
            </Text>
          )}
        </View>

        {/* Invite */}
        {forming && g.inviteCode && (
          <View className="mt-4 px-4 py-4 rounded-3xl" style={{ backgroundColor: colors.card }}>
            <Text className="text-muted dark:text-muted-dark text-xs">
              Invite code · {data.members.length} of {g.size} joined
            </Text>
            <View className="flex-row items-center justify-between mt-1">
              <Text className="text-ink dark:text-ink-dark" style={{ fontSize: 26, fontWeight: '800', letterSpacing: 4 }}>
                {g.inviteCode}
              </Text>
              <View className="flex-row" style={{ gap: 8 }}>
                <TouchableOpacity
                  onPress={() => Clipboard.setStringAsync(g.inviteCode as string)}
                  className="w-10 h-10 rounded-full items-center justify-center"
                  style={{ backgroundColor: colors.circle }}
                >
                  <Ionicons name="copy-outline" size={18} color={colors.ink} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() =>
                    Share.share({
                      message: `Join my Ajo group "${g.name}" on CheqPay: ${ngn(g.amount)} every ${every[g.frequency]}. Open Ajo savings in the app and enter code ${g.inviteCode}.`,
                    })
                  }
                  className="w-10 h-10 rounded-full items-center justify-center"
                  style={{ backgroundColor: colors.circle }}
                >
                  <Ionicons name="share-outline" size={18} color={colors.ink} />
                </TouchableOpacity>
              </View>
            </View>
            <Text className="text-muted dark:text-muted-dark text-xs mt-2">
              Only share it with people you trust to pay every round.
            </Text>
          </View>
        )}

        {/* Members */}
        <Text className="text-muted dark:text-muted-dark text-sm font-semibold mt-6 mb-2">
          {forming ? 'Members' : 'Collecting order'}
        </Text>
        <View className="rounded-3xl overflow-hidden" style={{ backgroundColor: colors.card }}>
          {ordered.map((m, i) => {
            const collected = g.status !== 'forming' && m.position !== null && m.position < g.currentRound;
            const now = g.status === 'active' && m.position === g.currentRound;
            return (
              <View
                key={`${m.username}-${i}`}
                className="flex-row items-center px-4 py-3.5"
                style={i > 0 ? { borderTopWidth: 1, borderTopColor: colors.border } : undefined}
              >
                <View
                  className="w-8 h-8 rounded-full items-center justify-center"
                  style={{ backgroundColor: now ? colors.brand : colors.circle }}
                >
                  <Text style={{ color: now ? colors.white : colors.muted, fontWeight: '700', fontSize: 12 }}>
                    {m.position ?? '·'}
                  </Text>
                </View>
                <View className="ml-3 flex-1">
                  <Text className="text-ink dark:text-ink-dark font-semibold">
                    @{m.username}
                    {m.isMe ? ' (you)' : ''}
                  </Text>
                  <Text className="text-muted dark:text-muted-dark text-xs">
                    {m.isOrganiser ? 'Organiser · ' : ''}
                    {now ? 'Collecting this round' : collected || g.status === 'completed' ? 'Collected' : forming ? 'Joined' : 'Waiting'}
                  </Text>
                </View>
                {m.behind && (
                  <Text style={{ color: '#F87171', fontSize: 12, fontWeight: '700' }}>Owes {ngn(m.owed)}</Text>
                )}
              </View>
            );
          })}
        </View>

        {/* Payouts */}
        {data.payouts.length > 0 && (
          <>
            <Text className="text-muted dark:text-muted-dark text-sm font-semibold mt-6 mb-2">Payouts</Text>
            <View className="rounded-3xl overflow-hidden" style={{ backgroundColor: colors.card }}>
              {data.payouts.map((p, i) => (
                <View
                  key={p.round}
                  className="flex-row justify-between px-4 py-3"
                  style={i > 0 ? { borderTopWidth: 1, borderTopColor: colors.border } : undefined}
                >
                  <Text className="text-ink dark:text-ink-dark">
                    Round {p.round} · @{p.collector}
                    {p.isMe ? ' (you)' : ''}
                  </Text>
                  <Text className="text-ink dark:text-ink-dark font-semibold">{ngn(p.amount)}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {/* Actions */}
        {forming && g.isOrganiser && (
          <>
            <TouchableOpacity
              onPress={() => act('start')}
              disabled={busy || data.members.length < 2}
              className="mt-6 flex-row items-center justify-center py-4 rounded-full"
              style={{ backgroundColor: colors.brand, opacity: busy || data.members.length < 2 ? 0.5 : 1 }}
            >
              {busy && <ActivityIndicator color={colors.white} style={{ marginRight: 8 }} />}
              <Text style={{ color: colors.white, fontWeight: '700', fontSize: 16 }}>
                {data.members.length < 2 ? 'Waiting for members' : `Start with ${data.members.length} members`}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => act('cancel')} disabled={busy} className="mt-4 items-center">
              <Text style={{ color: '#F87171', fontWeight: '600' }}>Cancel group</Text>
            </TouchableOpacity>
          </>
        )}
        {forming && !g.isOrganiser && (
          <TouchableOpacity onPress={() => act('leave')} disabled={busy} className="mt-6 items-center">
            <Text style={{ color: '#F87171', fontWeight: '600' }}>Leave group</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </View>
  );
}
