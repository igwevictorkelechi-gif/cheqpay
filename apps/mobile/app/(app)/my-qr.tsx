import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Share, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';
import { colors } from '@/components/brand';
import { api, ApiError, type VirtualAccount } from '@/services/api';

/**
 * "My code": the QR other people scan to pay this user. It encodes the user's
 * pay link (fetched from the server, which signs it). Anyone with CheqPay lands
 * in the pay flow; anyone without it lands on the web pay page, which shows the
 * Naira account below so they can transfer from any bank app.
 */
export default function MyQrScreen() {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [link, setLink] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [account, setAccount] = useState<VirtualAccount | null>(null);
  const [needsUsername, setNeedsUsername] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [payLink, va] = await Promise.all([
          api.getPayLink(),
          api.getVirtualAccount().catch(() => ({ virtualAccount: null })),
        ]);
        setLink(payLink.link);
        setUsername(payLink.username);
        setAccount(va.virtualAccount);
      } catch (e) {
        if (e instanceof ApiError && (e.body as { code?: string } | undefined)?.code === 'username_required') {
          setNeedsUsername(true);
        } else {
          setError('We couldn’t load your pay code. Please try again shortly.');
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function copy(text: string) {
    await Clipboard.setStringAsync(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  const Header = (
    <View className="flex-row items-center px-5 pt-3 pb-2">
      <TouchableOpacity onPress={() => router.back()} className="w-10 h-10 rounded-full bg-card dark:bg-card-dark items-center justify-center">
        <Ionicons name="chevron-back" size={22} color={colors.ink} />
      </TouchableOpacity>
      <Text className="text-ink dark:text-ink-dark text-lg font-bold ml-3">My pay code</Text>
    </View>
  );

  return (
    <View className="flex-1" style={{ backgroundColor: colors.surface, paddingTop: insets.top }}>
      {Header}
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 32 }}>
        {loading ? (
          <ActivityIndicator color={colors.brand} style={{ marginTop: 48 }} />
        ) : needsUsername ? (
          <View className="items-center py-12">
            <View className="w-16 h-16 rounded-full items-center justify-center" style={{ backgroundColor: colors.card }}>
              <Ionicons name="at" size={26} color={colors.brandLight} />
            </View>
            <Text className="text-ink dark:text-ink-dark text-lg font-bold mt-4">Pick a username first</Text>
            <Text className="text-muted dark:text-muted-dark text-sm mt-1 text-center px-6">
              Your pay code is tied to your @username. Set one, then come back to share your code.
            </Text>
            <TouchableOpacity
              onPress={() => router.replace('/(app)/personal-details')}
              className="mt-6 px-6 py-3 rounded-full"
              style={{ backgroundColor: colors.brand }}
            >
              <Text className="text-white font-bold">Set username</Text>
            </TouchableOpacity>
          </View>
        ) : error ? (
          <Text style={{ color: '#F87171', marginTop: 40, textAlign: 'center' }}>{error}</Text>
        ) : (
          <>
            <View className="items-center mt-4">
              <View className="bg-white rounded-3xl p-5">
                {link ? <QRCode value={link} size={220} /> : null}
              </View>
              <Text className="text-ink dark:text-ink-dark text-xl font-extrabold mt-4">@{username}</Text>
              <Text className="text-muted dark:text-muted-dark text-sm mt-1 text-center px-6">
                Scan this in CheqPay to pay me in Naira or crypto.
              </Text>
            </View>

            {account && (
              <View className="rounded-3xl p-5 mt-6" style={{ backgroundColor: colors.card }}>
                <Text className="text-muted dark:text-muted-dark text-xs font-semibold uppercase">Or pay my Naira account from any bank</Text>
                <View className="mt-2">
                  <Text className="text-muted dark:text-muted-dark text-xs font-semibold uppercase">Bank</Text>
                  <Text className="text-ink dark:text-ink-dark text-base font-bold mt-0.5">{account.bankName}</Text>
                </View>
                <View className="mt-3 flex-row items-center justify-between">
                  <View>
                    <Text className="text-muted dark:text-muted-dark text-xs font-semibold uppercase">Account number</Text>
                    <Text className="text-ink dark:text-ink-dark text-2xl font-extrabold mt-0.5" style={{ letterSpacing: 1 }}>
                      {account.accountNumber}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => copy(account.accountNumber)}
                    className="flex-row items-center rounded-full px-3 py-2"
                    style={{ backgroundColor: colors.surface }}
                  >
                    <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={16} color={copied ? colors.positive : colors.ink} />
                    <Text className="text-ink dark:text-ink-dark font-bold ml-1.5 text-sm">{copied ? 'Copied' : 'Copy'}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            <TouchableOpacity
              onPress={() => link && Share.share({ message: `Pay me on CheqPay: ${link}` })}
              disabled={!link}
              className="flex-row items-center justify-center py-4 rounded-full mt-6"
              style={{ backgroundColor: colors.brand, opacity: link ? 1 : 0.5 }}
            >
              <Ionicons name="share-social-outline" size={18} color="#fff" />
              <Text className="text-white font-bold ml-2">Share my pay link</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </View>
  );
}
