import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Image,
  Linking,
  Pressable,
  ScrollView,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { Card, colors, NairaFlag } from '@/components/brand';
import { api, type HomeBannerData } from '@/services/api';

const CACHE_KEY = 'cheqpay:home:banners';
/** How long each banner shows before the next slides in. */
const ROTATE_MS = 5000;
/** After a swipe, how long to leave the user in charge. */
const HOLD_AFTER_TOUCH_MS = 8000;

/**
 * The admin's live home banners, in order (empty when none). The last list is
 * kept so a returning user sees them straight away instead of a flash of the
 * Cash card.
 */
export function useHomeBanners(): HomeBannerData[] {
  const [banners, setBanners] = useState<HomeBannerData[]>([]);
  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(CACHE_KEY)
      .then((raw) => {
        if (active && raw) setBanners(JSON.parse(raw) as HomeBannerData[]);
      })
      .catch(() => undefined);
    api
      .getHomeBanners()
      .then(({ banners, banner }) => {
        if (!active) return;
        // An API from before the carousel sends just `banner`.
        const list = banners ?? (banner ? [banner] : []);
        setBanners(list);
        AsyncStorage.setItem(CACHE_KEY, JSON.stringify(list)).catch(() => undefined);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  return banners;
}

/**
 * The Cash card's layout with nothing visible: it gives the carousel exactly
 * the card's size on every phone and text-size setting, so nothing below moves.
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

/** One banner, filling a slide `width` wide. */
function Slide({ banner, width }: { banner: HomeBannerData; width: number }) {
  const link = banner.linkUrl?.trim() ?? '';
  const internal = link.startsWith('/') && !link.startsWith('//');
  const external = link.startsWith('https://');
  const hasText = Boolean(banner.title || banner.message);

  const open = () => {
    if (internal) router.push(link as never);
    else if (external) Linking.openURL(link).catch(() => undefined);
  };

  return (
    <Pressable
      onPress={internal || external ? open : undefined}
      disabled={!internal && !external}
      accessibilityRole={internal || external ? 'button' : undefined}
      accessibilityLabel={banner.title ?? 'Banner'}
      style={({ pressed }) => ({ width, height: '100%', backgroundColor: colors.brand, opacity: pressed ? 0.85 : 1 })}
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
            <Text numberOfLines={1} style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '700' }}>
              {banner.title}
            </Text>
          ) : null}
          {banner.message ? (
            <Text
              numberOfLines={2}
              style={{ color: 'rgba(255,255,255,0.85)', fontSize: 14, marginTop: 4, maxWidth: '85%' }}
            >
              {banner.message}
            </Text>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}

/**
 * The banners in the home screen's card slot. With more than one, they slide
 * by every few seconds and can be swiped; the dots show which is showing. A
 * swipe hands control to the user for a while, and nothing moves on its own
 * when the phone asks for reduced motion.
 */
export default function HomeBannerCarousel({ banners }: { banners: HomeBannerData[] }) {
  const scroller = useRef<ScrollView>(null);
  const holdUntil = useRef(0);
  const [width, setWidth] = useState(0);
  const [index, setIndex] = useState(0);
  const indexRef = useRef(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const many = banners.length > 1;

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then(setReduceMotion)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!many || !width || reduceMotion) return;
    const t = setInterval(() => {
      if (Date.now() < holdUntil.current) return;
      const next = (indexRef.current + 1) % banners.length;
      scroller.current?.scrollTo({ x: next * width, animated: true });
      indexRef.current = next;
      setIndex(next);
    }, ROTATE_MS);
    return () => clearInterval(t);
  }, [many, width, reduceMotion, banners.length]);

  const onSettled = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!width) return;
    indexRef.current = Math.round(e.nativeEvent.contentOffset.x / width);
    setIndex(indexRef.current);
  };

  return (
    <View>
      <CashCardSizer />
      <View
        className="rounded-3xl overflow-hidden"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.brand }}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      >
        {width > 0 ? (
          <ScrollView
            ref={scroller}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            scrollEnabled={many}
            onScrollBeginDrag={() => {
              holdUntil.current = Date.now() + HOLD_AFTER_TOUCH_MS;
            }}
            onMomentumScrollEnd={onSettled}
            style={{ flex: 1 }}
          >
            {banners.map((b) => (
              <Slide key={b.id} banner={b} width={width} />
            ))}
          </ScrollView>
        ) : null}
        {many ? (
          <View
            pointerEvents="none"
            style={{ position: 'absolute', left: 0, right: 0, bottom: 8, flexDirection: 'row', justifyContent: 'center' }}
          >
            {banners.map((b, i) => (
              <View
                key={b.id}
                style={{
                  width: i === index ? 16 : 6,
                  height: 6,
                  borderRadius: 3,
                  marginHorizontal: 3,
                  backgroundColor: i === index ? '#FFFFFF' : 'rgba(255,255,255,0.6)',
                }}
              />
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}
