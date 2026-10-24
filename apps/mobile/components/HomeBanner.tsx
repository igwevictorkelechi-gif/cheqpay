import { useEffect, useState } from 'react';
import { Image, Linking, Pressable, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { Card, colors, NairaFlag } from '@/components/brand';
import { api, type HomeBannerData } from '@/services/api';

const CACHE_KEY = 'cheqpay:home:banner';

/**
 * The admin's home banner, or null when none is live. The last one is kept so
 * a returning user sees it straight away instead of a flash of the Cash card.
 */
export function useHomeBanner(): HomeBannerData | null {
  const [banner, setBanner] = useState<HomeBannerData | null>(null);
  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(CACHE_KEY)
      .then((raw) => {
        if (active && raw) setBanner(JSON.parse(raw) as HomeBannerData | null);
      })
      .catch(() => undefined);
    api
      .getHomeBanner()
      .then(({ banner }) => {
        if (!active) return;
        setBanner(banner);
        AsyncStorage.setItem(CACHE_KEY, JSON.stringify(banner)).catch(() => undefined);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  return banner;
}

/**
 * The Cash card's layout with nothing visible: it gives the banner exactly the
 * card's size on every phone and text-size setting, so nothing below moves.
 */
function CashCardSizer() {
  return (
    <View
      style={{ opacity: 0 }}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Card>
        <Text className="text-base font-medium mb-4">Cash</Text>
        <View className="flex-row items-center">
          <NairaFlag />
          <View className="ml-3">
            <Text className="text-lg font-bold">NGN</Text>
            <Text className="text-sm">Naira</Text>
          </View>
        </View>
      </Card>
    </View>
  );
}

/** The banner in the home screen's card slot. */
export default function HomeBanner({ banner }: { banner: HomeBannerData }) {
  const link = banner.linkUrl?.trim() ?? '';
  const internal = link.startsWith('/') && !link.startsWith('//');
  const external = link.startsWith('https://');
  const hasText = Boolean(banner.title || banner.message);

  const open = () => {
    if (internal) router.push(link as never);
    else if (external) Linking.openURL(link).catch(() => undefined);
  };

  return (
    <View>
      <CashCardSizer />
      <View
        className="rounded-3xl overflow-hidden"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      >
        <Pressable
          onPress={internal || external ? open : undefined}
          disabled={!internal && !external}
          accessibilityRole={internal || external ? 'button' : undefined}
          accessibilityLabel={banner.title ?? 'Banner'}
          style={({ pressed }) => ({
            flex: 1,
            backgroundColor: colors.brand,
            opacity: pressed ? 0.85 : 1,
          })}
        >
          {banner.imageUrl ? (
            <Image
              source={{ uri: banner.imageUrl }}
              resizeMode="cover"
              style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
            />
          ) : null}
          {hasText ? (
            <View
              style={{
                flex: 1,
                justifyContent: 'center',
                paddingHorizontal: 20,
                backgroundColor: banner.imageUrl ? 'rgba(0,0,0,0.35)' : 'transparent',
              }}
            >
              {banner.title ? (
                <Text
                  numberOfLines={1}
                  style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '700' }}
                >
                  {banner.title}
                </Text>
              ) : null}
              {banner.message ? (
                <Text
                  numberOfLines={2}
                  style={{
                    color: 'rgba(255,255,255,0.85)',
                    fontSize: 14,
                    marginTop: 4,
                    maxWidth: '85%',
                  }}
                >
                  {banner.message}
                </Text>
              ) : null}
            </View>
          ) : null}
        </Pressable>
      </View>
    </View>
  );
}
