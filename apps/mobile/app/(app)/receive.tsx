import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Share, Modal } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';
import { colors } from '@/components/brand';
import { api, ApiError } from '@/services/api';
import { ASSET_META, CRYPTO_SEND } from '@/lib/assets';
import { readCache, writeCache } from '@/lib/cache';

type Sym = 'BTC' | 'USDT' | 'USDC';
const ASSETS: Sym[] = ['BTC', 'USDT', 'USDC'];

interface AddressEntry {
  asset: string;
  address: string;
  network: string;
  networkLabel: string;
}

/**
 * The whole deposit-address response, cached verbatim.
 *
 * One request already returns every asset and chain, so a single snapshot
 * serves every asset on this screen. Addresses are immutable once minted, which
 * is what makes serving a stored copy safe — the refresh behind it only ever
 * adds chains the user has since generated. Cleared on sign-out.
 */
interface DepositCache {
  addresses: AddressEntry[];
  networks: { network: string; label: string }[];
}

const CACHE_KEY = 'cheqpay:crypto:addresses';

/** Group one response into the three shapes the screen renders from. */
function project(addresses: AddressEntry[]) {
  const map: Record<string, string> = {};
  const labels: Record<string, string> = {};
  const grouped: Record<string, { address: string; network: string; networkLabel: string }[]> = {};
  for (const e of addresses) {
    // First address per asset is the default shown.
    if (!map[e.asset]) {
      map[e.asset] = e.address;
      labels[e.asset] = e.networkLabel;
    }
    (grouped[e.asset] ??= []).push({
      address: e.address,
      network: e.network,
      networkLabel: e.networkLabel,
    });
  }
  return { map, labels, grouped };
}

export default function ReceiveScreen() {
  const insets = useSafeAreaInsets();
  const [selected, setSelected] = useState<Sym | null>(null);
  const [addresses, setAddresses] = useState<Record<string, string>>({});
  const [netLabels, setNetLabels] = useState<Record<string, string>>({});
  // Every address per asset, one per chain. A stablecoin exists on several
  // networks and sending on the wrong one loses the funds, so the chain is an
  // explicit choice rather than an assumption.
  const [byAsset, setByAsset] = useState<
    Record<string, { address: string; network: string; networkLabel: string }[]>
  >({});
  // Chains with no address yet, offered in the same dropdown and minted on
  // selection — so a user is never stuck because their chain was added later.
  const [allNetworks, setAllNetworks] = useState<{ network: string; label: string }[]>([]);
  const [netPickerOpen, setNetPickerOpen] = useState(false);
  const [minting, setMinting] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const apply = (snap: DepositCache) => {
      const { map, labels, grouped } = project(snap.addresses);
      setAddresses(map);
      setNetLabels(labels);
      setByAsset(grouped);
      setAllNetworks(snap.networks);
    };

    (async () => {
      // Show the stored copy first. A deposit address does not change once it
      // is minted, so waiting on the network to display one the device already
      // has is a spinner for nothing.
      let hadCache = false;
      const cached = await readCache<DepositCache>(CACHE_KEY);
      if (cached && active && cached.addresses.length > 0) {
        hadCache = true;
        apply(cached);
      }

      try {
        // Per-user addresses minted by custody, with manual wallets as fallback.
        const { addresses, networks } = await api.getCryptoDepositAddresses();
        if (!active) return;
        const snapshot: DepositCache = { addresses, networks: networks ?? [] };
        apply(snapshot);
        void writeCache(CACHE_KEY, snapshot);
      } catch {
        // With addresses already on screen a failed refresh is not worth
        // reporting — what is shown is still correct and still usable.
        if (active && !hadCache) {
          setError('We couldn’t load deposit addresses. Please try again shortly.');
        }
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  /** Mint an address on a chain the user does not hold yet, then re-read. */
  async function generate(asset: string, network: string) {
    setMinting(network);
    setError(null);
    try {
      await api.createWallet(asset, network);
      const { addresses, networks } = await api.getCryptoDepositAddresses();
      const { map, labels, grouped } = project(addresses);
      // Show the chain that was just created, not whatever was selected before.
      const fresh = grouped[asset]?.find((g) => g.network === network);
      if (fresh) {
        map[asset] = fresh.address;
        labels[asset] = fresh.networkLabel;
      }
      setAddresses(map);
      setNetLabels(labels);
      setByAsset(grouped);
      setAllNetworks(networks ?? []);
      // The new address is now part of the stored set, so the next open shows
      // it without a round trip.
      void writeCache(CACHE_KEY, { addresses, networks: networks ?? [] });
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : 'We couldn’t create that address. Please try again.',
      );
    } finally {
      setMinting(null);
    }
  }

  async function copy(addr: string) {
    await Clipboard.setStringAsync(addr);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  const Header = (title: string, onBack: () => void) => (
    <View className="flex-row items-center px-5 pt-3 pb-2">
      <TouchableOpacity onPress={onBack} className="w-10 h-10 rounded-full bg-card dark:bg-card-dark items-center justify-center">
        <Ionicons name="chevron-back" size={22} color={colors.ink} />
      </TouchableOpacity>
      <Text className="text-ink dark:text-ink-dark text-lg font-bold ml-3">{title}</Text>
    </View>
  );

  // Detail view
  if (selected) {
    const meta = ASSET_META[selected];
    const info = CRYPTO_SEND[selected];
    const addr = addresses[selected];
    // Per asset: a chain held for USDT says nothing about USDC, so filtering
    // across every asset would hide a chain the user can still generate here.
    const held = new Set((byAsset[selected] ?? []).map((o) => o.network));
    const mintable = allNetworks.filter((n) => !held.has(n.network));
    return (
      <View className="flex-1" style={{ backgroundColor: colors.surface, paddingTop: insets.top }}>
        {Header(`Receive ${selected}`, () => setSelected(null))}
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 32, paddingHorizontal: 20 }}>
          <View className="items-center mt-4">
            <View className="rounded-full items-center justify-center" style={{ width: 56, height: 56, backgroundColor: meta.bg }}>
              <Text style={{ color: '#fff', fontSize: 26, fontWeight: '700' }}>{meta.glyph}</Text>
            </View>
            <Text className="text-ink dark:text-ink-dark text-lg font-bold mt-3">{meta.name}</Text>
            <Text className="text-muted dark:text-muted-dark text-sm">{netLabels[selected] ?? info.networkLabel}</Text>
          </View>

          {/* Network selector — the address differs per chain, so picking one
              swaps the QR and the address below it. A dropdown rather than a
              row of chips: the list grows with every chain, and chains with no
              address yet are offered here and minted on selection. */}
          {((byAsset[selected]?.length ?? 0) > 1 || mintable.length > 0) && (
            <View className="mt-5">
              <Text className="text-muted dark:text-muted-dark text-xs font-semibold uppercase mb-2">
                Network
              </Text>
              <TouchableOpacity
                onPress={() => setNetPickerOpen(true)}
                disabled={minting !== null}
                className="flex-row items-center justify-between rounded-2xl px-4 py-3.5"
                style={{
                  backgroundColor: colors.card,
                  borderWidth: 1,
                  borderColor: colors.border,
                  opacity: minting ? 0.6 : 1,
                }}
                activeOpacity={0.8}
              >
                <Text className="text-ink dark:text-ink-dark text-base font-semibold">
                  {minting
                    ? `Creating your ${minting} address…`
                    : (netLabels[selected] ?? info.networkLabel)}
                </Text>
                <Ionicons name="chevron-down" size={18} color={colors.muted} />
              </TouchableOpacity>
            </View>
          )}

          <Modal
            visible={netPickerOpen}
            transparent
            animationType="slide"
            onRequestClose={() => setNetPickerOpen(false)}
          >
            <TouchableOpacity
              className="flex-1 justify-end"
              style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
              activeOpacity={1}
              onPress={() => setNetPickerOpen(false)}
            >
              <View
                className="rounded-t-3xl p-5"
                style={{ backgroundColor: colors.surface, paddingBottom: insets.bottom + 16 }}
              >
                <Text className="text-ink dark:text-ink-dark text-lg font-bold mb-4">
                  Select network
                </Text>

                {(byAsset[selected] ?? []).map((o) => {
                  const active = o.address === addr;
                  return (
                    <TouchableOpacity
                      key={o.network}
                      onPress={() => {
                        setAddresses((m) => ({ ...m, [selected]: o.address }));
                        setNetLabels((m) => ({ ...m, [selected]: o.networkLabel }));
                        setNetPickerOpen(false);
                      }}
                      className="flex-row items-center justify-between rounded-2xl p-4 mb-2"
                      style={{ backgroundColor: colors.card }}
                      activeOpacity={0.7}
                    >
                      <Text className="text-ink dark:text-ink-dark font-semibold">
                        {o.networkLabel}
                      </Text>
                      {active && <Ionicons name="checkmark" size={18} color={colors.brand} />}
                    </TouchableOpacity>
                  );
                })}

                {mintable.map((n) => (
                  <TouchableOpacity
                    key={n.network}
                    onPress={() => {
                      setNetPickerOpen(false);
                      void generate(selected, n.network);
                    }}
                    className="flex-row items-center justify-between rounded-2xl p-4 mb-2"
                    style={{ borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border }}
                    activeOpacity={0.7}
                  >
                    <Text className="text-muted dark:text-muted-dark font-semibold">{n.label}</Text>
                    <Text style={{ color: colors.brand, fontSize: 12, fontWeight: '700' }}>
                      Generate
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </TouchableOpacity>
          </Modal>

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
            <Text className="text-muted dark:text-muted-dark text-xs font-semibold uppercase">Your {selected} address</Text>
            <Text className="text-ink dark:text-ink-dark text-sm font-medium mt-2">{addr ?? error ?? 'Loading…'}</Text>
          </View>

          <View className="flex-row mt-4" style={{ gap: 12 }}>
            <TouchableOpacity
              onPress={() => addr && copy(addr)}
              disabled={!addr}
              className="flex-1 rounded-2xl py-3.5 items-center flex-row justify-center"
              style={{ backgroundColor: colors.card, opacity: addr ? 1 : 0.4 }}
            >
              <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={18} color={copied ? colors.positive : colors.ink} />
              <Text className="text-ink dark:text-ink-dark font-bold ml-2">{copied ? 'Copied' : 'Copy'}</Text>
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
            <DetailRow label="Network" value={netLabels[selected] ?? info.networkLabel} />
            <DetailRow label="Minimum deposit" value={`${info.minSend} ${selected}`} bordered />
          </View>

          <View className="rounded-2xl p-4 mt-6 flex-row" style={{ backgroundColor: 'rgba(245,166,35,0.1)', borderWidth: 1, borderColor: 'rgba(245,166,35,0.3)' }}>
            <Ionicons name="warning-outline" size={20} color="#F5A623" />
            <Text className="text-xs ml-3 flex-1" style={{ color: '#F5C97B', lineHeight: 18 }}>
              Send only {selected} on the {netLabels[selected] ?? info.networkLabel} network to this address. Using the wrong
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
        <Text className="text-muted dark:text-muted-dark text-sm font-semibold mt-4 mb-2">Select asset</Text>
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
                  <Text className="text-ink dark:text-ink-dark text-lg font-bold">{sym}</Text>
                  <Text className="text-muted dark:text-muted-dark text-sm">{meta.name}</Text>
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
      <Text className="text-muted dark:text-muted-dark text-sm">{label}</Text>
      <Text className="text-ink dark:text-ink-dark text-sm font-semibold">{value}</Text>
    </View>
  );
}
