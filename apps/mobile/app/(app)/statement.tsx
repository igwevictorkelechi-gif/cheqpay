import { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { colors } from '@/components/brand';
import { api, ApiError } from '@/services/api';

type Format = 'pdf' | 'csv';

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}
const TODAY = new Date().toISOString().slice(0, 10);

const PRESETS: { label: string; days: number }[] = [
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 3 months', days: 90 },
  { label: 'Last 6 months', days: 182 },
  { label: 'Last year', days: 365 },
];

/**
 * Request an account statement for a period and have it emailed. Ranges are
 * chosen from presets — a full date picker would need a native module, and the
 * presets cover what people actually ask for.
 */
export default function StatementScreen() {
  const insets = useSafeAreaInsets();
  const [days, setDays] = useState(30);
  const [format, setFormat] = useState<Format>('pdf');
  const [available, setAvailable] = useState<boolean | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ email: string; count: number } | null>(null);

  useEffect(() => {
    api
      .getStatementAvailability()
      .then((r) => setAvailable(r.available))
      .catch(() => setAvailable(false));
  }, []);

  const from = useMemo(() => isoDaysAgo(days), [days]);

  async function submit() {
    setError(null);
    setSending(true);
    try {
      const res = await api.requestStatement({ from, to: TODAY, format });
      setSent({ email: res.email, count: res.count });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Couldn’t send your statement.');
    } finally {
      setSending(false);
    }
  }

  return (
    <View className="flex-1" style={{ backgroundColor: colors.surface, paddingTop: insets.top }}>
      <View className="flex-row items-center px-5 pt-3 pb-2">
        <TouchableOpacity
          onPress={() => router.back()}
          className="w-10 h-10 rounded-full bg-card dark:bg-card-dark items-center justify-center"
        >
          <Ionicons name="chevron-back" size={22} color={colors.ink} />
        </TouchableOpacity>
        <Text className="text-ink dark:text-ink-dark text-lg font-bold ml-3">Account statement</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32 }}>
        <Text className="text-muted dark:text-muted-dark text-sm mt-1 mb-5">
          Pick a period and a format — we’ll email it to you.
        </Text>

        {available === false ? (
          <View className="items-center py-12">
            <View
              className="w-16 h-16 rounded-full items-center justify-center"
              style={{ backgroundColor: colors.card }}
            >
              <Ionicons name="mail" size={26} color={colors.brandLight} />
            </View>
            <Text className="text-ink dark:text-ink-dark text-lg font-bold mt-4">Coming soon</Text>
            <Text className="text-muted dark:text-muted-dark text-sm mt-1 text-center px-6">
              Emailed statements aren’t switched on yet. You can still view your history under
              Wallet statement.
            </Text>
          </View>
        ) : sent ? (
          <View className="items-center py-10">
            <View
              className="w-16 h-16 rounded-full items-center justify-center"
              style={{ backgroundColor: 'rgba(52,199,89,0.15)' }}
            >
              <Ionicons name="mail-open" size={26} color={colors.positive} />
            </View>
            <Text className="text-ink dark:text-ink-dark text-lg font-bold mt-4">Statement on its way</Text>
            <Text className="text-muted dark:text-muted-dark text-sm mt-1 text-center px-6">
              We’ve emailed {sent.count} transaction{sent.count === 1 ? '' : 's'} to {sent.email}.
              It can take a minute — check spam if you don’t see it.
            </Text>
            <TouchableOpacity
              onPress={() => setSent(null)}
              className="mt-5 px-5 py-3 rounded-full bg-card dark:bg-card-dark"
            >
              <Text className="text-ink dark:text-ink-dark font-bold text-sm">Request another</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <Text className="text-muted dark:text-muted-dark text-sm font-semibold mb-2">Period</Text>
            <View style={{ gap: 10 }}>
              {PRESETS.map((p) => {
                const chosen = days === p.days;
                return (
                  <TouchableOpacity
                    key={p.label}
                    onPress={() => {
                      setDays(p.days);
                      setSent(null);
                    }}
                    activeOpacity={0.8}
                    className="flex-row items-center justify-between rounded-2xl p-4"
                    style={{
                      backgroundColor: chosen ? 'rgba(107,91,149,0.18)' : colors.card,
                      borderWidth: 1,
                      borderColor: chosen ? colors.brand : colors.border,
                    }}
                  >
                    <View>
                      <Text className="text-ink dark:text-ink-dark font-bold">{p.label}</Text>
                      <Text className="text-muted dark:text-muted-dark text-xs mt-0.5">
                        {p.days === 365 ? from : from} → {TODAY}
                      </Text>
                    </View>
                    <Ionicons
                      name={chosen ? 'radio-button-on' : 'radio-button-off'}
                      size={20}
                      color={chosen ? colors.brandLight : colors.muted}
                    />
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text className="text-muted dark:text-muted-dark text-sm font-semibold mt-6 mb-2">Format</Text>
            <View className="flex-row" style={{ gap: 12 }}>
              {(
                [
                  { id: 'pdf', label: 'PDF', hint: 'Best for printing', icon: 'document-text' },
                  { id: 'csv', label: 'CSV', hint: 'Open in a spreadsheet', icon: 'grid' },
                ] as const
              ).map((f) => {
                const chosen = format === f.id;
                return (
                  <TouchableOpacity
                    key={f.id}
                    onPress={() => {
                      setFormat(f.id);
                      setSent(null);
                    }}
                    activeOpacity={0.8}
                    className="flex-1 rounded-2xl p-4"
                    style={{
                      backgroundColor: chosen ? 'rgba(107,91,149,0.18)' : colors.card,
                      borderWidth: 1,
                      borderColor: chosen ? colors.brand : colors.border,
                    }}
                  >
                    <Ionicons
                      name={f.icon}
                      size={20}
                      color={chosen ? colors.brandLight : colors.muted}
                    />
                    <Text className="text-ink dark:text-ink-dark font-bold mt-1.5">{f.label}</Text>
                    <Text className="text-muted dark:text-muted-dark text-xs mt-0.5">{f.hint}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {error && <Text style={{ color: '#F87171', marginTop: 16 }}>{error}</Text>}

            <TouchableOpacity
              onPress={submit}
              disabled={sending || available === null}
              activeOpacity={0.9}
              className="mt-8 flex-row items-center justify-center py-4 rounded-full"
              style={{
                backgroundColor: colors.brand,
                opacity: sending || available === null ? 0.5 : 1,
              }}
            >
              {sending && <ActivityIndicator color={colors.white} style={{ marginRight: 8 }} />}
              <Text style={{ color: colors.white, fontWeight: '700', fontSize: 16 }}>
                {sending ? 'Sending…' : 'Email me the statement'}
              </Text>
            </TouchableOpacity>
            {Platform.OS === 'ios' && <View style={{ height: 8 }} />}
          </>
        )}
      </ScrollView>
    </View>
  );
}
