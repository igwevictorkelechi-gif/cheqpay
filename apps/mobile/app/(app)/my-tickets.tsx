import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import QRCode from 'react-native-qrcode-svg';
import { colors, Card } from '@/components/brand';
import { api, ApiError, type EventTicket, type TicketStatus } from '@/services/api';

const STATUS: Record<TicketStatus, { label: string; color: string }> = {
  VALID: { label: 'Valid', color: '#16A34A' },
  USED: { label: 'Checked in', color: '#2E8BFF' },
  CANCELLED: { label: 'Cancelled', color: '#EF4444' },
  REFUNDED: { label: 'Refunded', color: '#EF4444' },
};

function whenLabel(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleString('en-NG', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function MyTicketsScreen() {
  const insets = useSafeAreaInsets();
  const [tickets, setTickets] = useState<EventTicket[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getMyTickets()
      .then(({ tickets }) => setTickets(tickets))
      .catch((e) => { setError(e instanceof ApiError ? e.message : "Couldn't load your tickets."); setTickets([]); });
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface, paddingTop: insets.top }}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <TouchableOpacity onPress={() => router.push('/(app)/events')} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="arrow-back" size={20} color={colors.ink} />
        </TouchableOpacity>
        <Text style={{ color: colors.ink, fontSize: 32, fontWeight: '800', marginTop: 12, marginBottom: 16 }}>My tickets</Text>

        {tickets === null ? (
          <ActivityIndicator color={colors.muted} style={{ marginTop: 60 }} />
        ) : error ? (
          <Card><Text style={{ color: colors.muted, textAlign: 'center', paddingVertical: 20 }}>{error}</Text></Card>
        ) : tickets.length === 0 ? (
          <Card>
            <View style={{ paddingVertical: 28, alignItems: 'center' }}>
              <Ionicons name="calendar-outline" size={40} color={colors.muted} />
              <Text style={{ color: colors.muted, marginTop: 12 }}>No tickets yet.</Text>
              <TouchableOpacity onPress={() => router.push('/(app)/events')} style={{ marginTop: 16, backgroundColor: colors.brandLight, borderRadius: 999, paddingHorizontal: 32, paddingVertical: 12 }}>
                <Text style={{ color: colors.white, fontWeight: '800' }}>Browse events</Text>
              </TouchableOpacity>
            </View>
          </Card>
        ) : (
          tickets.map((t) => {
            const s = STATUS[t.status] ?? STATUS.VALID;
            const dimmed = t.status !== 'VALID';
            return (
              <View key={t.id} style={{ backgroundColor: colors.card, borderRadius: 16, overflow: 'hidden', marginBottom: 16 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', padding: 16 }}>
                  <View style={{ flex: 1, paddingRight: 10 }}>
                    <Text style={{ color: colors.ink, fontWeight: '700', fontSize: 15 }}>{t.eventTitle}</Text>
                    <Text style={{ color: colors.muted, fontSize: 13, marginTop: 2 }}>{t.tierName}</Text>
                    {whenLabel(t.startsAt) ? <Text style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>{whenLabel(t.startsAt)}</Text> : null}
                    {t.venue ? <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>{t.venue}</Text> : null}
                  </View>
                  <View style={{ backgroundColor: s.color, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4 }}>
                    <Text style={{ color: '#fff', fontSize: 12, fontWeight: '800' }}>{s.label}</Text>
                  </View>
                </View>
                <View style={{ backgroundColor: '#fff', alignItems: 'center', paddingVertical: 20 }}>
                  <View style={{ opacity: dimmed ? 0.4 : 1 }}>
                    <QRCode value={t.reference} size={150} />
                  </View>
                  <Text style={{ marginTop: 12, fontFamily: 'monospace', fontWeight: '700', color: '#1B1726' }}>{t.reference}</Text>
                  <Text style={{ marginTop: 2, fontSize: 12, color: '#6E6880' }}>Show this at the gate</Text>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}
