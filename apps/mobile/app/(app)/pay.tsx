import { useEffect } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { colors } from '@/components/brand';
import { parsePayCode } from '@/lib/payCode';

/**
 * Deep-link / universal-link target for the pay link's query form:
 * `cheqpay://pay?u=<username>` and `https://mycheqpay.com/pay?u=<username>`.
 * Carries the recipient into the Send screen, which confirms them before any
 * money moves. (The legacy path form `/pay/<username>` is handled by
 * `pay/[username].tsx`.)
 */
export default function PayQueryDeepLink() {
  const { u } = useLocalSearchParams<{ u?: string }>();

  useEffect(() => {
    const to = parsePayCode(u ?? '');
    router.replace(to ? { pathname: '/(app)/send-user', params: { to } } : '/(app)/send-user');
  }, [u]);

  return <View style={{ flex: 1, backgroundColor: colors.surface }} />;
}
