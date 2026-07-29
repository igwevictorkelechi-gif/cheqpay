import { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, Animated, Easing, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { colors } from '@/components/brand';
import { useFeatures } from '@/lib/useFeatures';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

/**
 * The visible tabs, in order. Declared here rather than derived from the
 * navigator because expo-router rewrites `href` into a `tabBarButton` that a
 * custom tab bar never calls — so the hidden screens (href: null) cannot be
 * told apart from the real tabs at this point.
 */
const TABS: { name: string; label: string; icon: IconName; iconOutline: IconName }[] = [
  { name: 'home', label: 'Home', icon: 'home', iconOutline: 'home-outline' },
  { name: 'crypto', label: 'Crypto', icon: 'logo-bitcoin', iconOutline: 'logo-bitcoin' },
  { name: 'pay-bill', label: 'Pay Bill', icon: 'pricetag', iconOutline: 'pricetag-outline' },
  { name: 'cards', label: 'Cards', icon: 'card', iconOutline: 'card-outline' },
];

/**
 * Floating "liquid glass" tab bar: a translucent pill inset from the screen
 * edges with a lighter capsule that slides behind the active tab. The active
 * icon switches to its solid variant in the brand tint and its label follows —
 * matching the iOS-26 style tab bars the design references.
 */
export default function TabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const features = useFeatures();
  const [rowWidth, setRowWidth] = useState(0);

  const cryptoVisible =
    features.crypto_trading || features.crypto_deposits || features.crypto_withdrawals;
  const tabs = TABS.filter((t) => {
    if (t.name === 'crypto') return cryptoVisible;
    if (t.name === 'pay-bill') return features.bill_payments;
    if (t.name === 'cards') return features.virtual_cards;
    return true;
  });

  const currentName = state.routes[state.index]?.name;
  const activeIndex = tabs.findIndex((t) => t.name === currentName);

  const slide = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (activeIndex < 0 || rowWidth === 0) return;
    Animated.timing(slide, {
      toValue: (rowWidth / tabs.length) * activeIndex,
      duration: 220,
      easing: Easing.bezier(0.22, 1, 0.36, 1),
      useNativeDriver: true,
    }).start();
  }, [activeIndex, rowWidth, tabs.length, slide]);

  return (
    <View style={[styles.wrap, { paddingBottom: insets.bottom > 0 ? insets.bottom : 12 }]}>
      <View style={styles.pill}>
        <View style={styles.row} onLayout={(e) => setRowWidth(e.nativeEvent.layout.width)}>
          {activeIndex >= 0 && rowWidth > 0 && (
            <Animated.View
              pointerEvents="none"
              style={[
                styles.capsule,
                {
                  width: rowWidth / tabs.length,
                  transform: [{ translateX: slide }],
                },
              ]}
            />
          )}

          {tabs.map((tab) => {
            const focused = tab.name === currentName;
            return (
              <Pressable
                key={tab.name}
                accessibilityRole="button"
                accessibilityState={focused ? { selected: true } : {}}
                accessibilityLabel={tab.label}
                onPress={() => {
                  if (!focused) navigation.navigate(tab.name as never);
                }}
                style={styles.item}
              >
                <Ionicons
                  name={focused ? tab.icon : tab.iconOutline}
                  size={22}
                  color={focused ? colors.brandLight : colors.muted}
                />
                <Text
                  style={[
                    styles.label,
                    focused
                      ? { color: colors.brandLight, fontWeight: '700' }
                      : { color: 'rgba(244,243,247,0.7)', fontWeight: '500' },
                  ]}
                >
                  {tab.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: 'transparent',
    paddingHorizontal: 22,
    paddingTop: 10,
  },
  pill: {
    height: 62,
    borderRadius: 31,
    // Near-opaque so it reads as glass over the dark surface. Swap for a
    // BlurView here if expo-blur is ever added.
    backgroundColor: 'rgba(31,27,41,0.94)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    paddingHorizontal: 6,
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  row: { flexDirection: 'row', alignItems: 'center' },
  capsule: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    height: 50,
    alignSelf: 'center',
    borderRadius: 25,
    backgroundColor: 'rgba(255,255,255,0.09)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  item: { flex: 1, alignItems: 'center', paddingVertical: 8, gap: 4 },
  label: { fontSize: 11, lineHeight: 13 },
});
