import { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, Image, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { colors, Card } from '@/components/brand';
import { api, ApiError, type AdCampaign } from '@/services/api';

const STATUS: Record<AdCampaign['status'], { label: string; color: string }> = {
  PENDING_REVIEW: { label: 'In review', color: '#F59E0B' },
  APPROVED: { label: 'Approved · starts soon', color: '#38BDF8' },
  LIVE: { label: 'Live', color: '#22C55E' },
  ENDED: { label: 'Finished', color: colors.muted },
  REJECTED: { label: 'Not approved', color: '#F87171' },
  CANCELLED: { label: 'Stopped', color: colors.muted },
};
const pretty = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' });

/** The advertiser's campaigns: status, money and results. */
export default function AdCampaignsScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ new?: string }>();
  const [list, setList] = useState<AdCampaign[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    api.getMyAdCampaigns().then((r) => setList(r.campaigns)).catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load your campaigns."));
  }, []);
  useEffect(load, [load]);

  function stop(c: AdCampaign) {
    const live = c.status === 'LIVE';
    Alert.alert(live ? 'Stop this ad?' : 'Cancel this ad?', live ? "Today's run is kept; the days left are refunded." : "You'll get a full refund.", [
      { text: 'Keep it', style: 'cancel' },
      {
        text: live ? 'Stop ad' : 'Cancel ad',
        style: 'destructive',
        onPress: async () => {
          setBusy(c.id);
          try {
            await api.cancelAdCampaign(c.id);
            load();
          } catch (e) {
            Alert.alert(e instanceof ApiError ? e.message : "Couldn't stop it. Try again.");
          } finally {
            setBusy(null);
          }
        },
      },
    ]);
  }

  return (
    <View className="flex-1" style={{ backgroundColor: colors.surface, paddingTop: insets.top + 8 }}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 40 }}>
        <View className="flex-row items-center justify-between">
          <TouchableOpacity onPress={() => router.back()} className="h-11 w-11 rounded-full items-center justify-center" style={{ backgroundColor: colors.card }}>
            <Ionicons name="arrow-back" size={20} color={colors.ink} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push('/(app)/advertise' as never)} className="rounded-full px-4 py-2.5" style={{ backgroundColor: colors.brand }}>
            <Text className="text-white font-bold text-sm">＋ New ad</Text>
          </TouchableOpacity>
        </View>
        <Text className="text-ink dark:text-ink-dark text-2xl font-extrabold mt-4 mb-3">My campaigns</Text>
        {params.new ? (
          <View className="rounded-2xl px-4 py-3 mb-3" style={{ backgroundColor: 'rgba(34,197,94,0.12)' }}>
            <Text style={{ color: '#4ADE80' }} className="text-sm">Paid and sent for review. We&apos;ll notify you as soon as it&apos;s approved.</Text>
          </View>
        ) : null}
        {!list ? (
          error ? <Card><Text className="text-muted dark:text-muted-dark text-center py-6">{error}</Text></Card> : <ActivityIndicator style={{ marginTop: 60 }} color={colors.brand} />
        ) : list.length === 0 ? (
          <Card>
            <Text className="text-ink dark:text-ink-dark font-bold text-center">No ads yet</Text>
            <Text className="text-muted dark:text-muted-dark text-sm text-center mt-1">Put your business in front of people where they pay.</Text>
          </Card>
        ) : (
          list.map((c) => {
            const st = STATUS[c.status];
            const ctr = c.stats.views ? ((c.stats.clicks / c.stats.views) * 100).toFixed(1) : '0.0';
            return (
              <Card key={c.id} className="mb-3">
                <View className="flex-row">
                  <Image alt="" source={{ uri: c.image }} style={{ width: 104, height: 56, borderRadius: 12 }} />
                  <View className="flex-1 ml-3">
                    <Text numberOfLines={1} className="text-ink dark:text-ink-dark font-bold">{c.headline}</Text>
                    <Text className="text-muted dark:text-muted-dark text-xs">{pretty(c.startDay)} → {pretty(c.endDay)} · {c.breakdown.length} place{c.breakdown.length === 1 ? '' : 's'}</Text>
                    <Text style={{ color: st.color }} className="text-xs font-semibold mt-1">{st.label}</Text>
                  </View>
                </View>
                {c.reason ? <Text className="text-xs mt-3 rounded-xl px-3 py-2" style={{ color: '#FCA5A5', backgroundColor: 'rgba(239,68,68,0.1)' }}>{c.reason}</Text> : null}
                <View className="flex-row mt-3">
                  {[[c.stats.views.toLocaleString('en-NG'), 'Views'], [c.stats.clicks.toLocaleString('en-NG'), 'Taps'], [`${ctr}%`, 'Tap rate']].map(([v, l]) => (
                    <View key={l} className="flex-1 items-center rounded-2xl py-2.5 mx-1" style={{ backgroundColor: colors.circle }}>
                      <Text className="text-ink dark:text-ink-dark text-lg font-extrabold">{v}</Text>
                      <Text className="text-muted dark:text-muted-dark text-[11px]">{l}</Text>
                    </View>
                  ))}
                </View>
                {c.stats.byChannel.map((ch) => (
                  <View key={ch.channel} className="flex-row justify-between mt-1.5">
                    <Text className="text-muted dark:text-muted-dark text-xs">{ch.label}</Text>
                    <Text className="text-ink dark:text-ink-dark text-xs">{ch.views.toLocaleString('en-NG')} views · {ch.clicks.toLocaleString('en-NG')} taps</Text>
                  </View>
                ))}
                <View className="flex-row items-center justify-between mt-3 pt-3" style={{ borderTopWidth: 1, borderColor: colors.border }}>
                  <Text className="text-muted dark:text-muted-dark text-xs">Paid {c.paidFormatted}{/^₦0(\.00)?$/.test(c.refundedFormatted) ? '' : ` · refunded ${c.refundedFormatted}`}</Text>
                  {['PENDING_REVIEW', 'APPROVED', 'LIVE'].includes(c.status) ? (
                    <TouchableOpacity onPress={() => stop(c)} disabled={busy === c.id}>
                      <Text style={{ color: '#F87171' }} className="text-xs font-semibold">{busy === c.id ? 'Stopping…' : c.status === 'LIVE' ? 'Stop ad' : 'Cancel'}</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              </Card>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}
