import { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, Alert, Share, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { colors } from '@/components/brand';
import { api, ApiError, type AjoGroupDetail } from '@/services/api';
import { avatarColor, dueLabel, every, initial, inviteUrl, ngn, shortDate } from '@/lib/ajo';

function Avatar({ name, size = 36, ring }: { name: string; size?: number; ring?: boolean }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: avatarColor(name),
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: ring ? 2 : 2,
        borderColor: ring ? colors.white : colors.card,
      }}
    >
      <Text style={{ color: colors.white, fontWeight: '800', fontSize: size * 0.42 }}>{initial(name)}</Text>
    </View>
  );
}

/**
 * One Ajo group: who's in it, who collects next, the invite code while it's
 * gathering people, who's behind, and what each round paid out.
 */
export default function AjoGroupScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [data, setData] = useState<AjoGroupDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
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
        title: `Start with ${data.members.length} people?`,
        body: `${
          g.payoutOrder === 'random' ? 'The collecting order is drawn now, fairly.' : 'People collect in the order they joined.'
        } Round 1 is taken at 9am tomorrow, and nobody else can join after this.`,
        ok: 'Start',
      },
      leave: { title: 'Leave this group?', body: 'You can join again with the code while it’s still gathering people.', ok: 'Leave' },
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

  function share() {
    const g = data?.group;
    if (!g?.inviteCode) return;
    Share.share({
      message: `Join my Ajo “${g.name}” on CheqPay: ${ngn(g.amount)} every ${every[g.frequency]}, ${ngn(g.pot)} pot. Tap ${inviteUrl(
        g.inviteCode,
      )} or enter code ${g.inviteCode} in the app.`,
    }).catch(() => undefined);
  }

  const Header = (
    <View className="flex-row items-center px-5 pt-3 pb-2">
      <TouchableOpacity
        onPress={() => router.back()}
        className="w-10 h-10 rounded-full bg-card dark:bg-card-dark items-center justify-center"
      >
        <Ionicons name="chevron-back" size={22} color={colors.ink} />
      </TouchableOpacity>
      <Text className="text-ink dark:text-ink-dark text-lg font-bold ml-3 flex-1" numberOfLines={1}>
        {data?.group.name ?? 'Ajo group'}
      </Text>
      {data?.group.inviteCode && (
        <TouchableOpacity onPress={share} className="w-10 h-10 rounded-full items-center justify-center" style={{ backgroundColor: colors.card }}>
          <Ionicons name="share-outline" size={20} color={colors.ink} />
        </TouchableOpacity>
      )}
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
  const collector = ordered.find((m) => m.position === g.currentRound);
  const me = data.members.find((m) => m.isMe);
  const myTurn = g.status === 'active' && me?.position === g.currentRound;
  const roundsLeft = Math.max(0, g.size - g.currentRound + 1);

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
        {/* Hero */}
        <View className="mt-2 px-5 py-5 rounded-3xl" style={{ backgroundColor: colors.brand }}>
          <View className="flex-row items-center">
            <View className="flex-row">
              {ordered.slice(0, 6).map((m, i) => (
                <View key={`${m.username}-${i}`} style={{ marginLeft: i === 0 ? 0 : -10 }}>
                  <Avatar name={m.username} size={32} ring />
                </View>
              ))}
              {ordered.length > 6 && (
                <View
                  style={{ marginLeft: -10, width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.25)', alignItems: 'center', justifyContent: 'center' }}
                >
                  <Text style={{ color: colors.white, fontSize: 11, fontWeight: '700' }}>+{ordered.length - 6}</Text>
                </View>
              )}
            </View>
            <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12, marginLeft: 10 }}>
              {data.members.length} of {g.size} people
            </Text>
          </View>
          <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 13, marginTop: 14 }}>Pot each round</Text>
          <Text style={{ color: colors.white, fontSize: 32, fontWeight: '800', marginTop: 2 }}>{ngn(g.pot)}</Text>
          <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 12, marginTop: 4 }}>
            {ngn(g.amount)} each, every {every[g.frequency]}
          </Text>
          {g.status === 'active' && (
            <View className="mt-4 px-3 py-2.5 rounded-2xl" style={{ backgroundColor: 'rgba(255,255,255,0.15)' }}>
              <Text style={{ color: colors.white, fontSize: 13, fontWeight: '700' }}>
                {myTurn ? '🎉 Your turn to collect' : `Up next: @${collector?.username ?? 'member'}`}
              </Text>
              <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12, marginTop: 2 }}>
                Round {g.currentRound} of {g.size} · {dueLabel(g.nextDueAt)} · {roundsLeft} {roundsLeft === 1 ? 'round' : 'rounds'} to go
              </Text>
            </View>
          )}
          {g.status === 'completed' && (
            <Text style={{ color: colors.white, fontSize: 13, fontWeight: '700', marginTop: 12 }}>
              🎉 Done. Everyone collected {ngn(g.pot)}.
            </Text>
          )}
          {forming && (
            <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12, marginTop: 12 }}>
              {g.isOrganiser
                ? data.members.length < 2
                  ? 'Invite at least one person to start.'
                  : 'Start whenever you’re ready, or wait for more people.'
                : 'Waiting for the organiser to start.'}
            </Text>
          )}
        </View>

        {/* Invite */}
        {forming && g.inviteCode && (
          <View className="mt-4 px-4 py-4 rounded-3xl" style={{ backgroundColor: colors.card }}>
            <Text className="text-muted dark:text-muted-dark text-xs">Invite code</Text>
            <View className="flex-row items-center justify-between mt-1">
              <Text className="text-ink dark:text-ink-dark" style={{ fontSize: 28, fontWeight: '800', letterSpacing: 5 }}>
                {g.inviteCode}
              </Text>
              <View className="flex-row" style={{ gap: 8 }}>
                <TouchableOpacity
                  onPress={async () => {
                    await Clipboard.setStringAsync(inviteUrl(g.inviteCode as string));
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                  className="px-3 h-10 rounded-full flex-row items-center"
                  style={{ backgroundColor: colors.circle }}
                >
                  <Ionicons name={copied ? 'checkmark' : 'link-outline'} size={16} color={colors.ink} />
                  <Text className="text-ink dark:text-ink-dark text-xs font-bold ml-1">{copied ? 'Copied' : 'Copy link'}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={share} className="px-3 h-10 rounded-full flex-row items-center" style={{ backgroundColor: colors.brand }}>
                  <Ionicons name="paper-plane-outline" size={16} color={colors.white} />
                  <Text style={{ color: colors.white, fontSize: 12, fontWeight: '700', marginLeft: 4 }}>Share</Text>
                </TouchableOpacity>
              </View>
            </View>
            <Text className="text-muted dark:text-muted-dark text-xs mt-2">
              Send it to people you’d trust with {ngn(g.amount)} every {every[g.frequency]}. Only them.
            </Text>
          </View>
        )}

        {/* Members */}
        <Text className="text-muted dark:text-muted-dark text-sm font-semibold mt-6 mb-2">
          {forming ? 'Who’s in' : 'Collecting order'}
        </Text>
        <View className="rounded-3xl overflow-hidden" style={{ backgroundColor: colors.card }}>
          {ordered.map((m, i) => {
            const collected = g.status === 'completed' || (!forming && m.position !== null && m.position < g.currentRound);
            const now = g.status === 'active' && m.position === g.currentRound;
            return (
              <View
                key={`${m.username}-${i}`}
                className="flex-row items-center px-4 py-3"
                style={[
                  i > 0 ? { borderTopWidth: 1, borderTopColor: colors.border } : undefined,
                  now ? { backgroundColor: 'rgba(107,91,149,0.18)' } : undefined,
                ]}
              >
                <Avatar name={m.username} />
                <View className="ml-3 flex-1">
                  <Text className="text-ink dark:text-ink-dark font-semibold">
                    @{m.username}
                    {m.isMe ? ' · you' : ''}
                  </Text>
                  <Text className="text-muted dark:text-muted-dark text-xs">
                    {m.isOrganiser ? 'Organiser · ' : ''}
                    {now ? 'Collecting this round' : collected ? 'Collected ✓' : forming ? 'In' : `Round ${m.position}`}
                  </Text>
                </View>
                {m.behind ? (
                  <View className="px-2.5 py-1 rounded-full" style={{ backgroundColor: 'rgba(248,113,113,0.15)' }}>
                    <Text style={{ color: '#F87171', fontSize: 11, fontWeight: '700' }}>Owes {ngn(m.owed)}</Text>
                  </View>
                ) : (
                  !forming && (
                    <Text style={{ color: now ? colors.brandLight : colors.muted, fontSize: 13, fontWeight: '800' }}>
                      #{m.position}
                    </Text>
                  )
                )}
              </View>
            );
          })}
        </View>

        {/* Payouts */}
        {data.payouts.length > 0 && (
          <>
            <Text className="text-muted dark:text-muted-dark text-sm font-semibold mt-6 mb-2">Payouts so far</Text>
            <View className="rounded-3xl overflow-hidden" style={{ backgroundColor: colors.card }}>
              {data.payouts.map((p, i) => (
                <View
                  key={p.round}
                  className="flex-row items-center px-4 py-3"
                  style={i > 0 ? { borderTopWidth: 1, borderTopColor: colors.border } : undefined}
                >
                  <Avatar name={p.collector} size={28} />
                  <Text className="text-ink dark:text-ink-dark ml-3 flex-1">
                    Round {p.round} · @{p.collector}
                    {p.isMe ? ' (you)' : ''}
                  </Text>
                  <View className="items-end">
                    <Text className="text-ink dark:text-ink-dark font-semibold">{ngn(p.amount)}</Text>
                    <Text className="text-muted dark:text-muted-dark text-xs">{shortDate(p.at)}</Text>
                  </View>
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
                {data.members.length < 2 ? 'Waiting for people' : `Start with ${data.members.length} people`}
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
        {!forming && (
          <Text className="text-muted dark:text-muted-dark text-xs mt-6 text-center">
            Contributions are taken at 9am on the day. The collector is paid the same minute.
          </Text>
        )}
      </ScrollView>
    </View>
  );
}
