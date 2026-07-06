import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Share } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';
import { colors } from '@/components/brand';
import { api } from '@/services/api';
import { ASSET_META, CRYPTO_SEND } from '@/lib/assets';

type Sym = 'BTC' | 'USDT' | 'USDC';
const ASSETS: Sym[] = ['BTC', 'USDT', 'USDC'];

export default function ReceiveScreen() {
  const insets = useSafeAreaInsets();
  const [selected, setSelected] = useState<Sym | null>(null);
  const [addresses, setAddresses] = useState<Record<string, string>>({});
  const [netLabels, setNetLabels] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        // Manual custody: live assets are the ones the admin configured.
        const { addresses } = await api.getCryptoDepositAddresses();
        const map: Record<string, string> = {};
        const labels: Record<string, string> = {};
        for (const e of addresses) {
          map[e.asset] = e.address;
          labels[e.asset] = e.networkLabel;
        }
        setAddresses(map);
        setNetLabels(labels);
      } catch {
        setError('We couldn’t load deposit addresses. Please try again shortly.');
      }
    })();
  }, []);

  async function copy(addr: string) {
    await Clipboard.setStringAsync(addr);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  const Header = (title: string, onBack: () => void) => (
    <View className="flex-row items-center px-5 pt-3 pb-2">
      <TouchableOpacity onPress={onBack} className="w-10 h-10 rounded-full bg-card items-center justify-center">
        <Ionicons name="chevron-back" size={22} color={colors.ink} />
      </TouchableOpacity>
      <Text className="text-ink text-lg font-bold ml-3">{title}</Text>
    </View>
  );

  // Detail view
  if (selected) {
    const meta = ASSET_META[selected];
    const info = CRYPTO_SEND[selected];
    const addr = addresses[selected];
    return (
      <View className="flex-1" style={{ backgroundColor: colors.surface, paddingTop: insets.top }}>
        {Header(`Receive ${selected}`, () => setSelected(null))}
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 32, paddingHorizontal: 20 }}>
          <View className="items-center mt-4">
            <View className="rounded-full items-center justify-center" style={{ width: 56, height: 56, backgroundColor: meta.bg }}>
              <Text style={{ color: '#fff', fontSize: 26, fontWeight: '700' }}>{meta.glyph}</Text>
            </View>
            <Text className="text-ink text-lg font-bold mt-3">{meta.name}</Text>
            <Text className="text-muted text-sm">{netLabels[selected] ?? info.networkLabel}</Text>
          </View>

          <View className="items-center mt-6">
            <View className="bg-white rounded-3xl p-5">
              {addr ? (
                <QRCode value={addr} size={208} />
              ) : (
                <View style={{ width: 208, height: 208 }} className="items-center justify-center">
                  <Text className="text-gray-400">Loading…</Text>
                </View>
              )}
            </View>
          </View>

          <View className="rounded-2xl p-4 mt-6" style={{ backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}>
            <Text className="text-muted text-xs font-semibold uppercase">Your {selected} address</Text>
            <Text className="text-ink text-sm font-medium mt-2">{addr ?? error ?? 'Loading…'}</Text>
          </View>

          <View className="flex-row mt-4" style={{ gap: 12 }}>
            <TouchableOpacity
              onPress={() => addr && copy(addr)}
              disabled={!addr}
              className="flex-1 rounded-2xl py-3.5 items-center flex-row justify-center"
              style={{ backgroundColor: colors.card, opacity: addr ? 1 : 0.4 }}
            >
              <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={18} color={copied ? colors.positive : colors.ink} />
              <Text className="text-ink font-bold ml-2">{copied ? 'Copied' : 'Copy'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => addr && Share.share({ message: addr })}
              disabled={!addr}
              className="flex-1 rounded-2xl py-3.5 items-center flex-row justify-center"
              style={{ backgroundColor: colors.brand, opacity: addr ? 1 : 0.4 }}
            >
              <Ionicons name="share-social-outline" size={18} color="#fff" />
              <Text className="text-white font-bold ml-2">Share</Text>
            </TouchableOpacity>
          </View>

          <View className="rounded-2xl overflow-hidden mt-6" style={{ backgroundColor: colors.card }}>
            <DetailRow label="Network" value={info.networkLabel} />
            <DetailRow label="Minimum deposit" value={`${info.minSend} ${selected}`} bordered />
          </View>

          <View className="rounded-2xl p-4 mt-6 flex-row" style={{ backgroundColor: 'rgba(245,166,35,0.1)', borderWidth: 1, borderColor: 'rgba(245,166,35,0.3)' }}>
            <Ionicons name="warning-outline" size={20} color="#F5A623" />
            <Text className="text-xs ml-3 flex-1" style={{ color: '#F5C97B', lineHeight: 18 }}>
              Send only {selected} on the {info.networkLabel} network to this address. Using the wrong
              coin or network will result in permanent loss of funds.
            </Text>
          </View>
        </ScrollView>
      </View>
    );
  }

  // Picker view
  return (
    <View className="flex-1" style={{ backgroundColor: colors.surface, paddingTop: insets.top }}>
      {Header('Receive crypto', () => router.back())}
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 32, paddingHorizontal: 20 }}>
        <Text className="text-muted text-sm font-semibold mt-4 mb-2">Select asset</Text>
        <View className="rounded-3xl overflow-hidden" style={{ backgroundColor: colors.card }}>
          {ASSETS.map((sym, i) => {
            const meta = ASSET_META[sym];
            const enabled = !!addresses[sym];
            return (
              <TouchableOpacity
                key={sym}
                onPress={() => enabled && setSelected(sym)}
                disabled={!enabled}
                className="flex-row items-center px-4 py-4"
                style={[
                  i > 0 ? { borderTopWidth: 1, borderTopColor: colors.border } : undefined,
                  enabled ? undefined : { opacity: 0.6 },
                ]}
              >
                <View className="rounded-full items-center justify-center" style={{ width: 44, height: 44, backgroundColor: meta.bg }}>
                  <Text style={{ color: '#fff', fontSize: 20, fontWeight: '700' }}>{meta.glyph}</Text>
                </View>
                <View className="ml-3 flex-1">
                  <Text className="text-ink text-lg font-bold">{sym}</Text>
                  <Text className="text-muted text-sm">{meta.name}</Text>
                </View>
                {enabled ? (
                  <Ionicons name="chevron-forward" size={20} color={colors.muted} />
                ) : (
                  <View className="rounded-full px-3 py-1.5" style={{ backgroundColor: 'rgba(107,91,149,0.15)' }}>
                    <Text style={{ color: colors.brandLight, fontSize: 11, fontWeight: '700' }}>Coming soon</Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

function DetailRow({ label, value, bordered }: { label: string; value: string; bordered?: boolean }) {
  return (
    <View
      className="flex-row items-center justify-between px-4 py-4"
      style={bordered ? { borderTopWidth: 1, borderTopColor: colors.border } : undefined}
    >
      <Text className="text-muted text-sm">{label}</Text>
      <Text className="text-ink text-sm font-semibold">{value}</Text>
    </View>
  );
}
