import { useEffect } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { colors } from '@/components/brand';
import { parsePayCode } from '@/lib/payCode';

/**
 * Deep-link / universal-link target for `cheqpay://pay/<username>` and
 * `https://mycheqpay.com/pay/<username>`. It carries the recipient into the Send
 * screen, which confirms them before any money moves. A junk username falls
 * back to the Send screen with nothing pre-filled rather than erroring.
 *
 * (Opening this cold while signed out bounces to login via the root auth gate;
 * the recipient isn't resumed afterwards — a known limitation for v1.)
 */
export default function PayDeepLink() {
  const { username } = useLocalSearchParams<{ username?: string }>();

  useEffect(() => {
    const to = parsePayCode(username ?? '');
    router.replace(to ? { pathname: '/(app)/send-user', params: { to } } : '/(app)/send-user');
  }, [username]);

  return <View style={{ flex: 1, backgroundColor: colors.surface }} />;
}
