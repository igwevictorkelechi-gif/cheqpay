import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { colors } from '@/components/brand';
import { api, type LedgerTransaction } from '@/services/api';

function iconFor(type: LedgerTransaction['type']): {
  name: React.ComponentProps<typeof Ionicons>['name'];
  color: string;
  bg: string;
} {
  switch (type) {
    case 'DEPOSIT':
      return { name: 'arrow-down', color: '#34C759', bg: 'rgba(52,199,89,0.15)' };
    case 'WITHDRAWAL':
      return { name: 'arrow-up', color: '#FF6B6B', bg: 'rgba(255,107,107,0.15)' };
    case 'BILL':
      return { name: 'flash', color: '#FBBF24', bg: 'rgba(251,191,36,0.15)' };
    default:
      return { name: 'swap-horizontal', color: '#A78BFA', bg: 'rgba(167,139,250,0.15)' };
  }
}

function messageFor(t: LedgerTransaction): string {
  const amt = `₦${Number(t.amountFormatted).toLocaleString('en-NG')}`;
  switch (t.type) {
    case 'DEPOSIT':
      return t.status === 'COMPLETED' ? `${amt} was added to your wallet.` : `Your deposit of ${amt} is being confirmed.`;
    case 'WITHDRAWAL':
      return t.status === 'COMPLETED'
        ? 'Your withdrawal was sent successfully.'
        : t.status === 'REVERSED' || t.status === 'FAILED'
          ? 'Your withdrawal failed and was refunded.'
          : 'Your withdrawal is processing.';
    case 'BILL': {
      const svc = t.billerName ?? t.service ?? 'Bill';
      return t.status === 'COMPLETED' ? `${svc} paid successfully.` : `${svc} is processing.`;
    }
    default:
      return `${t.type.toLowerCase()} — ${t.status.toLowerCase()}.`;
  }
}

function relativeTime(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' });
}

export default function ActivityScreen() {
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<LedgerTransaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .getTransactions(20)
      .then(({ transactions }) => setItems(transactions))
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  return (
    <View className="flex-1" style={{ backgroundColor: colors.surface, paddingTop: insets.top }}>
      <View className="flex-row items-center px-5 pt-3 pb-3" style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <TouchableOpacity onPress={() => router.back()} className="w-10 h-10 rounded-full bg-card items-center justify-center">
          <Ionicons name="chevron-back" size={22} color={colors.ink} />
        </TouchableOpacity>
        <Text className="text-ink text-lg font-bold ml-3">Notifications</Text>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.muted} style={{ marginTop: 40 }} />
      ) : items.length === 0 ? (
        <View className="flex-1 items-center justify-center px-6">
          <View className="w-16 h-16 rounded-full items-center justify-center" style={{ backgroundColor: colors.card }}>
            <Ionicons name="notifications-outline" size={28} color={colors.muted} />
          </View>
          <Text className="text-ink font-bold mt-4">You&apos;re all caught up</Text>
          <Text className="text-muted text-sm mt-1 text-center">
            Deposits, withdrawals and payments will show up here.
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
          {items.map((t) => {
            const ic = iconFor(t.type);
            return (
              <TouchableOpacity
                key={t.id}
                onPress={() => router.push(`/(app)/transaction/${t.id}`)}
                className="flex-row items-start px-5 py-4"
                style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}
                activeOpacity={0.7}
              >
                <View className="w-10 h-10 rounded-full items-center justify-center" style={{ backgroundColor: ic.bg, marginTop: 2 }}>
                  <Ionicons name={ic.name} size={20} color={ic.color} />
                </View>
                <View className="flex-1 ml-3">
                  <Text className="text-ink text-sm font-semibold">{messageFor(t)}</Text>
                  <Text className="text-muted text-xs mt-1">{relativeTime(t.createdAt)}</Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}
