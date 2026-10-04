import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { colors, Card } from '@/components/brand';
import { api, ApiError, type GiftCardTrade, type GiftCardTradeStatus } from '@/services/api';

const STATUS: Record<GiftCardTradeStatus, { label: string; color: string }> = {
  SUBMITTED: { label: 'Submitted', color: '#6B5B95' },
  IN_REVIEW: { label: 'Reviewing', color: '#F5A623' },
  APPROVED: { label: 'Paid', color: '#16A34A' },
  REJECTED: { label: 'Not accepted', color: '#EF4444' },
};

export default function GiftCardTradesScreen() {
  const insets = useSafeAreaInsets();
  const [trades, setTrades] = useState<GiftCardTrade[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getGiftCardTrades()
      .then(({ trades }) => setTrades(trades))
      .catch((e) => {
        setError(e instanceof ApiError ? e.message : "Couldn't load your trades.");
        setTrades([]);
      });
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface, paddingTop: insets.top }}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        <TouchableOpacity onPress={() => router.back()} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="arrow-back" size={20} color={colors.ink} />
        </TouchableOpacity>
        <Text style={{ color: colors.ink, fontSize: 28, fontWeight: '800', marginTop: 12, marginBottom: 16 }}>My gift card trades</Text>
        {trades === null ? (
          <ActivityIndicator color={colors.muted} style={{ marginTop: 60 }} />
        ) : error ? (
          <Card><Text style={{ color: colors.muted, textAlign: 'center', paddingVertical: 20 }}>{error}</Text></Card>
        ) : trades.length === 0 ? (
          <Card>
            <View style={{ alignItems: 'center', paddingVertical: 28 }}>
              <Ionicons name="gift-outline" size={40} color={colors.muted} />
              <Text style={{ color: colors.muted, marginTop: 10 }}>No trades yet.</Text>
            </View>
          </Card>
        ) : (
          trades.map((t) => {
            const s = STATUS[t.status];
            return (
              <Card key={t.id} className="mb-3">
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <View style={{ flex: 1, paddingRight: 8 }}>
                    <Text style={{ color: colors.ink, fontWeight: '700' }}>{t.brandName} · {t.faceValueFormatted}</Text>
                    <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
                      {t.countryName} · {t.cardType === 'ECODE' ? 'E-code' : 'Physical'} · {new Date(t.createdAt).toLocaleDateString('en-NG')}
                    </Text>
                  </View>
                  <View style={{ backgroundColor: `${s.color}22`, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start' }}>
                    <Text style={{ color: s.color, fontSize: 12, fontWeight: '700' }}>{s.label}</Text>
                  </View>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: colors.border, marginTop: 12, paddingTop: 12 }}>
                  <Text style={{ color: colors.muted }}>{t.status === 'APPROVED' ? 'Paid to your balance' : "You'll get"}</Text>
                  <Text style={{ color: t.status === 'REJECTED' ? colors.muted : colors.ink, fontWeight: '800', textDecorationLine: t.status === 'REJECTED' ? 'line-through' : 'none' }}>{t.payoutFormatted}</Text>
                </View>
                {t.status === 'REJECTED' && t.rejectReason ? (
                  <Text style={{ color: '#EF4444', fontSize: 12, marginTop: 8 }}>{t.rejectReason}</Text>
                ) : null}
              </Card>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}
