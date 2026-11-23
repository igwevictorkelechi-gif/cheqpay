import React from 'react';
import { View, Text, TouchableOpacity, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

/**
 * CheqPay shared brand UI primitives.
 * Centralises the colours and layout pieces that repeat across the
 * Home, Crypto and Pay Bill tabs so the look stays consistent.
 */
// The palette lives in ./theme so it can be swapped at runtime for light mode.
// Re-exported here because 40-odd screens already import { colors } from
// '@/components/brand' — they keep working and pick up the active theme.
export { colors, applyPalette, darkPalette, lightPalette } from './theme';
export type { Palette } from './theme';

import { colors } from './theme';

/** Horizontal CheqPay wordmark logo. */
export function Logo({ width = 200 }: { width?: number }) {
  // Source logo is 1942 x 809 — keep that aspect ratio.
  const height = Math.round(width * (809 / 1942));
  return (
    <Image
      source={require('../assets/logo.png')}
      style={{ width, height }}
      resizeMode="contain"
    />
  );
}

/** Small circular avatar shown top-left of each tab. */
export function Avatar({ uri, name }: { uri?: string | null; name?: string | null }) {
  const initial = (name || 'C').trim().charAt(0).toUpperCase();
  return (
    <View
      className="w-11 h-11 rounded-full items-center justify-center overflow-hidden"
      style={{ backgroundColor: '#D81E9B' }}
    >
      {uri ? (
        <Image source={{ uri }} className="w-11 h-11" />
      ) : (
        <Text className="text-white font-bold text-lg">{initial}</Text>
      )}
    </View>
  );
}

/** A round white icon button used in the top bar. */
export function TopIcon({
  name,
  onPress,
}: {
  name: React.ComponentProps<typeof Ionicons>['name'];
  onPress?: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      className="w-11 h-11 rounded-full bg-card dark:bg-card-dark items-center justify-center ml-3"
      style={{ borderWidth: 1, borderColor: colors.border }}
      activeOpacity={0.7}
    >
      <Ionicons name={name} size={18} color={colors.ink} />
    </TouchableOpacity>
  );
}

/** Top bar: avatar on the left, a set of round icon buttons on the right. */
export function TopBar({
  name,
  avatarUri,
  icons,
  onAvatarPress,
}: {
  name?: string | null;
  avatarUri?: string | null;
  icons: { name: React.ComponentProps<typeof Ionicons>['name']; onPress?: () => void }[];
  onAvatarPress?: () => void;
}) {
  return (
    <View className="flex-row items-center justify-between px-5 pt-2 pb-1">
      <TouchableOpacity onPress={onAvatarPress} activeOpacity={onAvatarPress ? 0.7 : 1} disabled={!onAvatarPress}>
        <Avatar name={name} uri={avatarUri} />
      </TouchableOpacity>
      <View className="flex-row items-center">
        {icons.map((icon) => (
          <TopIcon key={String(icon.name)} name={icon.name} onPress={icon.onPress} />
        ))}
      </View>
    </View>
  );
}

/** Centered "Total ... Balance" + big amount block. */
export function BalanceBlock({ label, amount }: { label: string; amount: string }) {
  return (
    <View className="items-center mt-4 mb-7">
      <CapsLabel>{label}</CapsLabel>
      <Text
        className="text-ink dark:text-ink-dark font-extrabold mt-2"
        style={{ fontSize: 34, lineHeight: 38, letterSpacing: -0.7, fontVariant: ['tabular-nums'] }}
      >
        {amount}
      </Text>
    </View>
  );
}

/** A round grey quick-action button with a label underneath. */
export function CircleAction({
  icon,
  label,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress?: () => void;
}) {
  return (
    <TouchableOpacity className="items-center" onPress={onPress} activeOpacity={0.7}>
      <View
        className="w-16 h-16 rounded-full items-center justify-center"
        style={{ backgroundColor: colors.circle }}
      >
        <Ionicons name={icon} size={24} color={colors.ink} />
      </View>
      <Text className="text-ink dark:text-ink-dark font-semibold text-sm mt-2">{label}</Text>
    </TouchableOpacity>
  );
}

/** Row of quick-action buttons, evenly spaced. */
export function ActionRow({ children }: { children: React.ReactNode }) {
  return (
    // Fixed gap rather than the web's padding: four 60pt buttons fit a 360pt
    // phone with room to spare, and never spill off the edges.
    <View className="flex-row justify-center px-5 mb-8" style={{ gap: 34 }}>
      {children}
    </View>
  );
}

/** Small Nigerian flag rendered as a circle (green / white / green). */
export function NairaFlag({ size = 44 }: { size?: number }) {
  return (
    <View
      className="flex-row overflow-hidden rounded-full"
      style={{ width: size, height: size }}
    >
      <View style={{ flex: 1, backgroundColor: '#008751' }} />
      <View style={{ flex: 1, backgroundColor: colors.white }} />
      <View style={{ flex: 1, backgroundColor: '#008751' }} />
    </View>
  );
}

/**
 * v2 small-caps label: 11px, bold, +6% tracking, uppercase, muted. Section
 * labels ("NEXT UP", "TOTAL BALANCE") and date headers.
 */
export function CapsLabel({ children, style }: { children: React.ReactNode; style?: object }) {
  return (
    <Text
      style={[
        { fontSize: 11, lineHeight: 14, fontWeight: '700', letterSpacing: 0.66, textTransform: 'uppercase', color: colors.muted },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

/**
 * Section header: an ink heading, a muted chevron at the far end. Ink rather
 * than brand purple — v2 keeps purple for one accent per screen.
 */
export function SectionHeader({
  title,
  onPress,
}: {
  title: string;
  onPress?: () => void;
}) {
  return (
    <TouchableOpacity
      className="flex-row items-center justify-between mb-3"
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text style={{ color: colors.ink, fontWeight: '700', fontSize: 17, letterSpacing: -0.2 }}>{title}</Text>
      <Ionicons name="chevron-forward" size={18} color={colors.muted} />
    </TouchableOpacity>
  );
}

/**
 * The v2 card edge: a translucent border, and a lighter top edge that does
 * what an inset highlight does on the web — lifts the card off a black page,
 * where a drop shadow has nothing to darken.
 */
export function cardEdge() {
  return { borderWidth: 1, borderColor: colors.border, borderTopColor: colors.cardTopEdge };
}

/** White rounded card wrapper. */
export function Card({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <View className={`bg-card dark:bg-card-dark rounded-3xl p-5 ${className}`} style={cardEdge()}>
      {children}
    </View>
  );
}

/** Rounded card for edge-to-edge rows (transaction lists): no inner padding. */
export function ListCard({ children }: { children: React.ReactNode }) {
  return (
    <View className="bg-card dark:bg-card-dark rounded-3xl overflow-hidden" style={cardEdge()}>
      {children}
    </View>
  );
}
