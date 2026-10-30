import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { colors } from '@/components/brand';
import { api, ApiError, type PriceAlert } from '@/services/api';
import { useFeatures } from '@/lib/useFeatures';

const ASSETS = ['BTC', 'USDT', 'USDC'];

/**
 * Standing crypto price alerts. The user sets a target ("notify me when BTC
 * goes above $70,000"); the server checks prices on a schedule and pushes once
 * when it's crossed, then the alert pauses until re-armed here.
 */
export default function PriceAlertsScreen() {
  const insets = useSafeAreaInsets();
  const features = useFeatures();

  const [alerts, setAlerts] = useState<PriceAlert[] | null>(null);
  const [asset, setAsset] = useState('BTC');
  const [direction, setDirection] = useState<'ABOVE' | 'BELOW'>('ABOVE');
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const { alerts } = await api.listPriceAlerts();
      setAlerts(alerts);
    } catch {
      setAlerts([]);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function add() {
    setError(null);
    setBusy(true);
    try {
      await api.createPriceAlert({ asset, direction, target: target.trim() });
      setTarget('');
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Couldn’t create that alert.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setAlerts((prev) => prev?.filter((a) => a.id !== id) ?? null); // optimistic
    try {
      await api.deletePriceAlert(id);
    } catch {
      load();
    }
  }

  async function rearm(id: string) {
    setAlerts((prev) => prev?.map((a) => (a.id === id ? { ...a, active: true } : a)) ?? null);
    try {
      await api.togglePriceAlert(id, true);
    } catch {
      load();
    }
  }

  const targetNum = Number(target);
  const canAdd = Number.isFinite(targetNum) && targetNum > 0 && !busy;

  const inputStyle = {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: colors.ink,
    fontSize: 16,
  };

  const Header = (
    <View className="flex-row items-center px-5 pt-3 pb-2">
      <TouchableOpacity onPress={() => router.back()} className="w-10 h-10 rounded-full bg-card dark:bg-card-dark items-center justify-center">
        <Ionicons name="chevron-back" size={22} color={colors.ink} />
      </TouchableOpacity>
      <Text className="text-ink dark:text-ink-dark text-lg font-bold ml-3">Price alerts</Text>
    </View>
  );

  if (!features.price_alerts) {
    return (
      <View className="flex-1" style={{ backgroundColor: colors.surface, paddingTop: insets.top }}>
        {Header}
        <View className="items-center py-16 px-8">
          <Ionicons name="notifications-off-outline" size={36} color={colors.brandLight} />
          <Text className="text-ink dark:text-ink-dark text-lg font-bold mt-4">Not available yet</Text>
          <Text className="text-muted dark:text-muted-dark text-sm mt-1 text-center">
            Price alerts aren’t switched on right now.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1">
      <View className="flex-1" style={{ backgroundColor: colors.surface, paddingTop: insets.top }}>
        {Header}
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 40 }}>
          <Text className="text-muted dark:text-muted-dark text-sm mt-1 mb-5">
            Get a push when a coin hits your target. Turn on “Price alerts” in Notifications so we can reach you.
          </Text>

          {/* Create */}
          <Text className="text-muted dark:text-muted-dark text-sm font-semibold mb-2">Coin</Text>
          <View className="flex-row" style={{ gap: 8 }}>
            {ASSETS.map((a) => (
              <TouchableOpacity
                key={a}
                onPress={() => setAsset(a)}
                className="px-4 py-2 rounded-full"
                style={{ backgroundColor: asset === a ? colors.brand : colors.card }}
              >
                <Text style={{ color: asset === a ? colors.white : colors.muted, fontWeight: '700', fontSize: 13 }}>{a}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text className="text-muted dark:text-muted-dark text-sm font-semibold mt-5 mb-2">When the price goes</Text>
          <View className="flex-row" style={{ gap: 8 }}>
            {(['ABOVE', 'BELOW'] as const).map((d) => (
              <TouchableOpacity
                key={d}
                onPress={() => setDirection(d)}
                className="flex-1 py-3 rounded-2xl items-center"
                style={{ backgroundColor: direction === d ? colors.brand : colors.card }}
              >
                <Text style={{ color: direction === d ? colors.white : colors.muted, fontWeight: '700', fontSize: 14 }}>
                  {d === 'ABOVE' ? 'Above' : 'Below'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text className="text-muted dark:text-muted-dark text-sm font-semibold mt-5 mb-1.5">Target price (USD)</Text>
          <TextInput
            value={target}
            onChangeText={(t) => {
              setTarget(t.replace(/[^\d.]/g, ''));
              setError(null);
            }}
            keyboardType="decimal-pad"
            placeholder="70000"
            placeholderTextColor={colors.muted}
            style={inputStyle}
          />

          {error && <Text style={{ color: '#F87171', marginTop: 12 }}>{error}</Text>}

          <TouchableOpacity
            onPress={add}
            disabled={!canAdd}
            className="mt-5 flex-row items-center justify-center py-4 rounded-full"
            style={{ backgroundColor: colors.brand, opacity: canAdd ? 1 : 0.5 }}
          >
            {busy && <ActivityIndicator color={colors.white} style={{ marginRight: 8 }} />}
            <Text style={{ color: colors.white, fontWeight: '700', fontSize: 16 }}>Add alert</Text>
          </TouchableOpacity>

          {/* List */}
          <Text className="text-muted dark:text-muted-dark text-sm font-semibold mt-8 mb-2">Your alerts</Text>
          {alerts === null ? (
            <ActivityIndicator color={colors.brand} style={{ marginTop: 16 }} />
          ) : alerts.length === 0 ? (
            <Text className="text-muted dark:text-muted-dark text-sm">No alerts yet.</Text>
          ) : (
            <View className="rounded-3xl overflow-hidden" style={{ backgroundColor: colors.card }}>
              {alerts.map((a, i) => (
                <View
                  key={a.id}
                  className="flex-row items-center justify-between px-4 py-4"
                  style={i > 0 ? { borderTopWidth: 1, borderTopColor: colors.border } : undefined}
                >
                  <View className="flex-1">
                    <Text className="text-ink dark:text-ink-dark font-bold">
                      {a.asset} {a.direction === 'ABOVE' ? '≥' : '≤'} ${Number(a.target).toLocaleString('en-US')}
                    </Text>
                    <Text className="text-muted dark:text-muted-dark text-xs mt-0.5">
                      {a.active ? 'Active' : a.lastTriggeredAt ? 'Triggered — tap to re-arm' : 'Paused'}
                    </Text>
                  </View>
                  {!a.active && (
                    <TouchableOpacity onPress={() => rearm(a.id)} className="px-3 py-2 rounded-full mr-2" style={{ backgroundColor: colors.surface }}>
                      <Text style={{ color: colors.brand, fontWeight: '700', fontSize: 12 }}>Re-arm</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity onPress={() => remove(a.id)} className="w-9 h-9 rounded-full items-center justify-center" style={{ backgroundColor: colors.surface }}>
                    <Ionicons name="trash-outline" size={16} color="#F87171" />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}
