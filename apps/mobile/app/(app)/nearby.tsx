import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, Image, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { colors, Card } from '@/components/brand';
import { api, ApiError, type NearbyVenue } from '@/services/api';

const distanceLabel = (km: number | null) => (km === null ? null : km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(km < 10 ? 1 : 0)} km`);

/** Partner places — gyms, restaurants, stores — in your area, with their current offers. */
export default function NearbyScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ venue?: string }>();
  const [venues, setVenues] = useState<NearbyVenue[] | null>(null);
  const [categories, setCategories] = useState<{ key: string; label: string }[]>([]);
  const [category, setCategory] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(params.venue ?? null);
  const [basis, setBasis] = useState<'location' | 'state' | 'all'>('all');
  const [error, setError] = useState<string | null>(null);
  const seen = useRef<Set<string>>(new Set());

  const load = useCallback((cat: string | null) => {
    api
      .nearbyVenues({ category: cat })
      .then((r) => {
        setVenues(r.venues);
        setCategories(r.categories);
        setBasis(r.basis);
      })
      .catch((e) => {
        setError(e instanceof ApiError ? e.message : "Couldn't load places near you.");
        setVenues([]);
      });
  }, []);
  useEffect(() => load(null), [load]);

  useEffect(() => {
    for (const v of venues ?? []) {
      if (seen.current.has(v.id)) continue;
      seen.current.add(v.id);
      void api.venueEvent(v.id, 'view', v.offer?.campaignId).catch(() => undefined);
    }
  }, [venues]);

  function pick(cat: string | null) {
    setCategory(cat);
    setVenues(null);
    load(cat);
  }

  function expand(v: NearbyVenue) {
    setOpen(open === v.id ? null : v.id);
    if (open !== v.id) void api.venueEvent(v.id, 'tap', v.offer?.campaignId).catch(() => undefined);
  }

  return (
    <View className="flex-1" style={{ backgroundColor: colors.surface, paddingTop: insets.top + 8 }}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}>
        <View className="px-5">
          <TouchableOpacity onPress={() => router.back()} className="h-11 w-11 rounded-full items-center justify-center" style={{ backgroundColor: colors.card }}>
            <Ionicons name="arrow-back" size={20} color={colors.ink} />
          </TouchableOpacity>
          <Text className="text-ink dark:text-ink-dark text-2xl font-extrabold mt-4">Places near you</Text>
          <Text className="text-muted dark:text-muted-dark text-sm mt-1">{basis === 'location' ? 'Nearest first.' : basis === 'state' ? 'In your state.' : 'CheqPay partner places.'}</Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 14 }}>
          {[{ key: null as string | null, label: 'All' }, ...categories].map((c) => {
            const on = category === c.key;
            return (
              <TouchableOpacity key={c.key ?? 'all'} onPress={() => pick(c.key)} className="rounded-full px-3.5 py-2 mr-2" style={{ borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? 'rgba(107,91,149,0.22)' : 'transparent' }}>
                <Text className={`text-sm font-semibold ${on ? 'text-ink dark:text-ink-dark' : 'text-muted dark:text-muted-dark'}`}>{c.label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        <View className="px-5">
          {!venues ? (
            <ActivityIndicator style={{ marginTop: 40 }} color={colors.brand} />
          ) : venues.length === 0 ? (
            <Card><Text className="text-muted dark:text-muted-dark text-center py-6">{error ?? 'No partner places here yet.'}</Text></Card>
          ) : (
            venues.map((v) => (
              <View key={v.id} className="bg-card dark:bg-card-dark rounded-3xl mb-3 overflow-hidden" style={v.featured ? { borderWidth: 1, borderColor: 'rgba(251,191,36,0.5)' } : undefined}>
                <TouchableOpacity onPress={() => expand(v)} className="flex-row p-3">
                  {v.photo ? (
                    <Image alt="" source={{ uri: v.photo }} style={{ width: 96, height: 80, borderRadius: 16 }} />
                  ) : (
                    <View style={{ width: 96, height: 80, borderRadius: 16, backgroundColor: colors.circle }} className="items-center justify-center"><Ionicons name="location" size={22} color={colors.muted} /></View>
                  )}
                  <View className="flex-1 ml-3">
                    {v.featured ? <Text className="text-[11px] font-bold mb-0.5" style={{ color: '#FBBF24' }}>★ Featured</Text> : null}
                    <Text className="text-ink dark:text-ink-dark font-bold" numberOfLines={1}>{v.name}</Text>
                    <Text className="text-muted dark:text-muted-dark text-xs" numberOfLines={1}>{[v.categoryLabel, distanceLabel(v.distanceKm), v.city].filter(Boolean).join(' · ')}</Text>
                    <Text className="text-xs mt-1" style={{ color: v.openNow === null ? colors.muted : v.openNow ? '#4ADE80' : '#F87171' }}>
                      {v.openNow === null ? 'Hours not listed' : v.openNow ? 'Open now' : 'Closed'}{v.hours ? ` · ${v.hours}` : ''}
                    </Text>
                    {v.offer && open !== v.id ? <Text className="text-xs font-semibold mt-1" style={{ color: '#FBBF24' }} numberOfLines={1}>{v.offer.headline}</Text> : null}
                  </View>
                </TouchableOpacity>
                {open === v.id ? (
                  <View className="p-4" style={{ borderTopWidth: 1, borderColor: colors.border }}>
                    {v.description ? <Text className="text-muted dark:text-muted-dark text-sm mb-2">{v.description}</Text> : null}
                    {v.address ? <Text className="text-ink dark:text-ink-dark text-sm mb-3">📍 {v.address}{v.city ? `, ${v.city}` : ''}</Text> : null}
                    {v.offer ? (
                      <View className="rounded-2xl overflow-hidden mb-3" style={{ backgroundColor: colors.circle }}>
                        <Image alt="" source={{ uri: v.offer.image }} style={{ width: '100%', aspectRatio: 1.91 }} />
                        <View className="p-3">
                          <Text className="text-muted dark:text-muted-dark text-[11px] font-semibold">Offer from {v.name}</Text>
                          <Text className="text-ink dark:text-ink-dark font-bold">{v.offer.headline}</Text>
                          {v.offer.body ? <Text className="text-muted dark:text-muted-dark text-sm">{v.offer.body}</Text> : null}
                          {v.offer.linkUrl ? (
                            <TouchableOpacity onPress={() => Linking.openURL(v.offer!.linkUrl!)} className="rounded-full px-3.5 py-2 mt-2 self-start" style={{ backgroundColor: colors.brand }}>
                              <Text className="text-white text-xs font-bold">{v.offer.cta} ↗</Text>
                            </TouchableOpacity>
                          ) : null}
                        </View>
                      </View>
                    ) : null}
                    {v.mapsUrl ? (
                      <TouchableOpacity onPress={() => Linking.openURL(v.mapsUrl!)} className="rounded-full py-3 items-center" style={{ backgroundColor: colors.brand }}>
                        <Text className="text-white font-bold">Directions</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                ) : null}
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </View>
  );
}
