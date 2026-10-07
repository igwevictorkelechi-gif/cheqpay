import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { colors } from '@/components/brand';
import { useFeatures } from '@/lib/useFeatures';
import { api, type NearbyVenue } from '@/services/api';

const distanceLabel = (km: number | null) => (km === null ? null : km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(km < 10 ? 1 : 0)} km`);

/** "Places near you" on the home screen: the three nearest partner venues. */
export default function NearbyStrip() {
  const features = useFeatures();
  const [venues, setVenues] = useState<NearbyVenue[] | null>(null);

  useEffect(() => {
    if (!features.ads) return;
    let live = true;
    api.nearbyVenues().then((r) => live && setVenues(r.venues.slice(0, 3))).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [features.ads]);

  if (!venues?.length) return null;
  return (
    <View className="mb-5">
      <View className="flex-row items-center justify-between px-5 mb-2">
        <Text className="text-ink dark:text-ink-dark font-bold text-base">Places near you</Text>
        <TouchableOpacity onPress={() => router.push('/(app)/nearby' as never)}>
          <Text style={{ color: colors.brand }} className="font-semibold text-sm">See all ›</Text>
        </TouchableOpacity>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20 }}>
        {venues.map((v) => (
          <TouchableOpacity key={v.id} onPress={() => router.push({ pathname: '/(app)/nearby', params: { venue: v.id } } as never)} className="bg-card dark:bg-card-dark rounded-3xl mr-3 overflow-hidden" style={{ width: 190 }}>
            {v.offer?.image || v.photo ? (
              <Image alt="" source={{ uri: v.offer?.image ?? v.photo! }} style={{ width: '100%', height: 96 }} />
            ) : (
              <View style={{ width: '100%', height: 96, backgroundColor: colors.circle }} className="items-center justify-center"><Ionicons name="location" size={22} color={colors.muted} /></View>
            )}
            <View className="p-3">
              <Text className="text-ink dark:text-ink-dark font-bold text-sm" numberOfLines={1}>{v.featured ? '★ ' : ''}{v.name}</Text>
              <Text className="text-muted dark:text-muted-dark text-xs" numberOfLines={1}>{[v.categoryLabel, distanceLabel(v.distanceKm) ?? v.city].filter(Boolean).join(' · ')}</Text>
              {v.offer ? <Text className="text-xs font-semibold mt-1" style={{ color: '#FBBF24' }} numberOfLines={1}>{v.offer.headline}</Text> : null}
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}
