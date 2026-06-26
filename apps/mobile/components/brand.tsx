import React from 'react';
import { View, Text, TouchableOpacity, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

/**
 * CheqPay shared brand UI primitives.
 * Centralises the colours and layout pieces that repeat across the
 * Home, Crypto and Pay Bill tabs so the look stays consistent.
 */
export const colors = {
  brand: '#6B5B95',
  brandDark: '#574A7A',
  brandLight: '#8A7BB5',
  surface: '#14121A',
  surfaceSoft: '#1F1B29',
  card: '#1F1B29',
  circle: '#2C2738',
  border: '#2A2535',
  ink: '#F4F3F7',
  muted: '#9A93AD',
  positive: '#34C759',
  white: '#FFFFFF',
};

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
      className="w-10 h-10 rounded-full bg-card items-center justify-center ml-3"
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
      <Text className="text-muted text-base">{label}</Text>
      <Text className="text-ink font-extrabold mt-2" style={{ fontSize: 40 }}>
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
      <Text className="text-ink font-semibold text-sm mt-2">{label}</Text>
    </TouchableOpacity>
  );
}

/** Row of quick-action buttons, evenly spaced. */
export function ActionRow({ children }: { children: React.ReactNode }) {
  return (
    <View className="flex-row justify-center px-10 mb-8" style={{ gap: 36 }}>
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

/** Section header with a chevron, e.g. "Transactions >". */
export function SectionHeader({
  title,
  onPress,
}: {
  title: string;
  onPress?: () => void;
}) {
  return (
    <TouchableOpacity
      className="flex-row items-center mb-3"
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text className="text-brand font-bold text-base">{title}</Text>
      <Ionicons name="chevron-forward" size={18} color={colors.brand} />
    </TouchableOpacity>
  );
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
    <View className={`bg-card rounded-3xl p-5 ${className}`}>{children}</View>
  );
}
