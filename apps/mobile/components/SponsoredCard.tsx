import { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Image, Linking, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { colors } from '@/components/brand';
import { useFeatures } from '@/lib/useFeatures';
import { api, type AdPlacement, type ServedAd } from '@/services/api';

/**
 * An advertiser's ad, clearly labelled "Sponsored", chosen for this person and
 * this place in the app. A view counts once it has been on screen for a second.
 */
export default function SponsoredCard({ placement, style }: { placement: AdPlacement; style?: object }) {
  const features = useFeatures();
  const [ad, setAd] = useState<ServedAd | null>(null);
  const [why, setWhy] = useState(false);
  const [hidden, setHidden] = useState(false);
  const counted = useRef(false);

  useEffect(() => {
    if (!features.ads) return;
    let live = true;
    api
      .serveAd(placement, Platform.OS === 'ios' ? 'ios' : 'android')
      .then((r) => live && setAd(r.ad))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [features.ads, placement]);

  useEffect(() => {
    if (!ad || counted.current) return;
    const t = setTimeout(() => {
      counted.current = true;
      void api.adEvent(ad.campaignId, ad.channel, 'view').catch(() => undefined);
    }, 1000);
    return () => clearTimeout(t);
  }, [ad]);

  if (!ad || hidden) return null;

  const open = () => {
    void api.adEvent(ad.campaignId, ad.channel, 'click').catch(() => undefined);
    if (ad.linkUrl) void Linking.openURL(ad.linkUrl);
  };

  return (
    <View className="bg-card dark:bg-card-dark rounded-3xl overflow-hidden" style={style}>
      <View className="flex-row items-center justify-between px-4 pt-3">
        <Text className="text-muted dark:text-muted-dark text-[11px] font-semibold">
          Sponsored · <Text className="text-ink dark:text-ink-dark">{ad.businessName}</Text>
        </Text>
        <View className="flex-row">
          <TouchableOpacity onPress={() => setWhy((w) => !w)} className="h-7 w-7 items-center justify-center" accessibilityLabel="Why am I seeing this ad?">
            <Ionicons name="information-circle-outline" size={16} color={colors.muted} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setHidden(true)} className="h-7 w-7 items-center justify-center" accessibilityLabel="Hide this ad">
            <Ionicons name="close" size={16} color={colors.muted} />
          </TouchableOpacity>
        </View>
      </View>
      {why && (
        <TouchableOpacity onPress={() => router.push('/(app)/ad-preferences' as never)} className="mx-4 mt-2 rounded-2xl px-3 py-2" style={{ backgroundColor: colors.circle }}>
          <Text className="text-muted dark:text-muted-dark text-xs">
            You&apos;re seeing this because: <Text className="text-ink dark:text-ink-dark">{ad.why.join(' · ')}</Text>.{' '}
            <Text style={{ color: colors.brand }} className="font-semibold">Ad preferences</Text>
          </Text>
        </TouchableOpacity>
      )}
      <TouchableOpacity activeOpacity={ad.linkUrl ? 0.85 : 1} onPress={open} className="p-4 pt-3">
        <Image accessibilityIgnoresInvertColors alt="" source={{ uri: ad.image }} style={{ width: '100%', aspectRatio: 1.91, borderRadius: 16, backgroundColor: colors.circle }} resizeMode="cover" />
        <View className="flex-row items-end justify-between mt-3">
          <View className="flex-1 pr-3">
            <Text className="text-ink dark:text-ink-dark font-bold">{ad.headline}</Text>
            {ad.body ? <Text className="text-muted dark:text-muted-dark text-sm mt-0.5">{ad.body}</Text> : null}
          </View>
          {ad.linkUrl ? (
            <View className="rounded-full px-3.5 py-2 flex-row items-center" style={{ backgroundColor: colors.brand }}>
              <Text className="text-white text-xs font-bold">{ad.cta}</Text>
              <Ionicons name="arrow-up-outline" size={12} color="#fff" style={{ marginLeft: 4, transform: [{ rotate: '45deg' }] }} />
            </View>
          ) : null}
        </View>
      </TouchableOpacity>
    </View>
  );
}
