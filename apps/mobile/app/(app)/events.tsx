import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { colors, Card } from '@/components/brand';
import { api, ApiError, type EventItem, type EventTier } from '@/services/api';
import { useTransactionPin, PIN_CANCELLED } from '@/components/TransactionPinProvider';

type Step = 'browse' | 'buy' | 'done';

function whenLabel(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleString('en-NG', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function EventsScreen() {
  const insets = useSafeAreaInsets();
  const { authorize } = useTransactionPin();

  const [events, setEvents] = useState<EventItem[] | null>(null);
  const [comingSoon, setComingSoon] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [step, setStep] = useState<Step>('browse');
  const [selected, setSelected] = useState<EventItem | null>(null);
  const [tierId, setTierId] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    api.getEvents()
      .then(({ events }) => setEvents(events))
      .catch((e) => {
        if (e instanceof ApiError && e.status === 503) { setComingSoon(true); setEvents([]); }
        else { setError(e instanceof ApiError ? e.message : "Couldn't load events."); setEvents([]); }
      });
  }, []);

  function openEvent(ev: EventItem) {
    setSelected(ev);
    const first = ev.tiers.find((t) => t.available);
    setTierId(first ? first.id : null);
    setQty(1);
    setFormError(null);
    setStep('buy');
  }

  const tier: EventTier | undefined = selected?.tiers.find((t) => t.id === tierId);
  const maxQty = Math.min(10, tier?.remaining ?? 10);

  async function pay() {
    if (!selected || !tier) return;
    setBusy(true);
    setFormError(null);
    try {
      await authorize(
        (pin) => api.buyTickets({ eventId: selected.id, tierId: tier.id, quantity: qty }, pin),
        { title: 'Confirm this purchase', detail: `${qty} × ${tier.name}` },
      );
      setStep('done');
    } catch (e) {
      if (e instanceof Error && e.message === PIN_CANCELLED) { setBusy(false); return; }
      setFormError(e instanceof ApiError ? e.message : "That didn't go through. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  // ---- Done ----
  if (step === 'done' && selected) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.surface, paddingTop: insets.top }}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
          <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="ticket" size={40} color={colors.brandLight} />
          </View>
          <Text style={{ color: colors.ink, fontSize: 24, fontWeight: '800', marginTop: 24 }}>You&apos;re going!</Text>
          <Text style={{ color: colors.muted, fontSize: 14, textAlign: 'center', marginTop: 8, lineHeight: 20 }}>
            {qty} × {tier?.name} for {selected.title} confirmed.
          </Text>
          <TouchableOpacity onPress={() => router.push('/(app)/my-tickets')} style={{ marginTop: 32, backgroundColor: colors.brandLight, borderRadius: 999, paddingHorizontal: 40, paddingVertical: 14 }}>
            <Text style={{ color: colors.white, fontWeight: '800', fontSize: 16 }}>View my tickets</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setStep('browse')} style={{ marginTop: 12 }}>
            <Text style={{ color: colors.muted, fontWeight: '600' }}>Back to events</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ---- Buy ----
  if (step === 'buy' && selected) {
    const total = tier ? (Number(tier.priceMinor) * qty) / 100 : 0;
    return (
      <View style={{ flex: 1, backgroundColor: colors.surface, paddingTop: insets.top }}>
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 48 }}>
          <TouchableOpacity onPress={() => setStep('browse')} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="arrow-back" size={20} color={colors.ink} />
          </TouchableOpacity>

          {selected.imageUrl ? (
            <Image source={{ uri: selected.imageUrl }} style={{ width: '100%', height: 190, borderRadius: 16, marginTop: 16 }} resizeMode="cover" />
          ) : null}
          <Text style={{ color: colors.ink, fontSize: 24, fontWeight: '800', marginTop: 16 }}>{selected.title}</Text>
          {whenLabel(selected.startsAt) ? <Text style={{ color: colors.muted, fontSize: 14, marginTop: 4 }}>{whenLabel(selected.startsAt)}</Text> : null}
          {selected.venue || selected.city ? <Text style={{ color: colors.muted, fontSize: 13, marginTop: 2 }}>{[selected.venue, selected.city].filter(Boolean).join(', ')}</Text> : null}
          {selected.description ? <Text style={{ color: colors.muted, fontSize: 14, lineHeight: 20, marginTop: 8 }}>{selected.description}</Text> : null}

          <Text style={{ color: colors.ink, fontSize: 18, fontWeight: '700', marginTop: 24, marginBottom: 10 }}>Choose a ticket</Text>
          {selected.tiers.map((t) => {
            const sel = t.id === tierId;
            return (
              <TouchableOpacity key={t.id} disabled={!t.available} onPress={() => { setTierId(t.id); setQty(1); }}
                style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderWidth: 1, borderColor: sel ? colors.brandLight : colors.border, backgroundColor: colors.card, borderRadius: 16, padding: 14, marginBottom: 8, opacity: t.available ? 1 : 0.5 }}>
                <View>
                  <Text style={{ color: colors.ink, fontWeight: '700' }}>{t.name}</Text>
                  <Text style={{ color: colors.muted, fontSize: 13 }}>{t.available ? (t.remaining !== null ? `${t.remaining} left` : 'Available') : 'Sold out'}</Text>
                </View>
                <Text style={{ color: colors.brandLight, fontWeight: '800' }}>{t.priceFormatted}</Text>
              </TouchableOpacity>
            );
          })}

          {tier && tier.available ? (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 20 }}>
                <Text style={{ color: colors.ink, fontSize: 16, fontWeight: '600' }}>Quantity</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
                  <TouchableOpacity onPress={() => setQty((q) => Math.max(1, q - 1))} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ color: colors.ink, fontSize: 20, fontWeight: '800' }}>−</Text>
                  </TouchableOpacity>
                  <Text style={{ color: colors.ink, fontSize: 18, fontWeight: '800', width: 24, textAlign: 'center' }}>{qty}</Text>
                  <TouchableOpacity onPress={() => setQty((q) => Math.min(maxQty, q + 1))} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ color: colors.ink, fontSize: 20, fontWeight: '800' }}>+</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.card, borderRadius: 16, padding: 16, marginTop: 20 }}>
                <Text style={{ color: colors.muted, fontSize: 14 }}>Total</Text>
                <Text style={{ color: colors.ink, fontSize: 20, fontWeight: '800' }}>₦{total.toLocaleString('en-NG', { maximumFractionDigits: 2 })}</Text>
              </View>

              {formError ? <Text style={{ color: '#F87171', fontSize: 13, marginTop: 12 }}>{formError}</Text> : null}

              <TouchableOpacity onPress={pay} disabled={busy}
                style={{ marginTop: 20, backgroundColor: colors.brandLight, borderRadius: 999, paddingVertical: 16, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8, opacity: busy ? 0.6 : 1 }}>
                {busy ? <ActivityIndicator color={colors.white} size="small" /> : null}
                <Text style={{ color: colors.white, fontSize: 16, fontWeight: '800' }}>{busy ? 'Booking…' : 'Pay & get tickets'}</Text>
              </TouchableOpacity>
            </>
          ) : null}
        </ScrollView>
      </View>
    );
  }

  // ---- Browse ----
  return (
    <View style={{ flex: 1, backgroundColor: colors.surface, paddingTop: insets.top }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 12 }}>
          <TouchableOpacity onPress={() => router.push('/(app)/pay-bill')} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="arrow-back" size={20} color={colors.ink} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push('/(app)/my-tickets')} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Ionicons name="ticket-outline" size={16} color={colors.brandLight} />
            <Text style={{ color: colors.brandLight, fontWeight: '600', fontSize: 14 }}>My tickets</Text>
          </TouchableOpacity>
        </View>

        <Text style={{ color: colors.ink, fontSize: 32, fontWeight: '800', paddingHorizontal: 20, marginTop: 12 }}>Events</Text>
        <Text style={{ color: colors.muted, fontSize: 14, paddingHorizontal: 20, marginTop: 4, marginBottom: 16 }}>Concerts, shows and more.</Text>

        {events === null ? (
          <ActivityIndicator color={colors.muted} style={{ marginTop: 60 }} />
        ) : comingSoon ? (
          <View style={{ paddingHorizontal: 20 }}><Card><View style={{ paddingVertical: 24, alignItems: 'center' }}><Text style={{ fontSize: 36 }}>🎫</Text><Text style={{ color: colors.ink, fontSize: 18, fontWeight: '700', marginTop: 12 }}>Coming soon</Text><Text style={{ color: colors.muted, fontSize: 14, textAlign: 'center', marginTop: 4 }}>Events are almost ready.</Text></View></Card></View>
        ) : error ? (
          <View style={{ paddingHorizontal: 20 }}><Card><Text style={{ color: colors.muted, textAlign: 'center', paddingVertical: 20 }}>{error}</Text></Card></View>
        ) : events.length === 0 ? (
          <View style={{ paddingHorizontal: 20 }}><Card><Text style={{ color: colors.muted, textAlign: 'center', paddingVertical: 28 }}>No events listed yet.</Text></Card></View>
        ) : (
          <View style={{ paddingHorizontal: 20 }}>
            {events.map((ev) => (
              <TouchableOpacity key={ev.id} activeOpacity={0.85} onPress={() => openEvent(ev)}
                style={{ flexDirection: 'row', backgroundColor: colors.card, borderRadius: 16, overflow: 'hidden', marginBottom: 12 }}>
                <View style={{ width: 96, height: 96, backgroundColor: colors.circle, alignItems: 'center', justifyContent: 'center' }}>
                  {ev.imageUrl ? <Image source={{ uri: ev.imageUrl }} style={{ width: '100%', height: '100%' }} resizeMode="cover" /> : <Ionicons name="calendar" size={32} color={colors.muted} />}
                </View>
                <View style={{ flex: 1, padding: 12 }}>
                  <Text numberOfLines={2} style={{ color: colors.ink, fontWeight: '700', fontSize: 14 }}>{ev.title}</Text>
                  {whenLabel(ev.startsAt) ? <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>{whenLabel(ev.startsAt)}</Text> : null}
                  {ev.venue || ev.city ? <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>{[ev.venue, ev.city].filter(Boolean).join(', ')}</Text> : null}
                  <Text style={{ color: colors.brandLight, fontWeight: '800', fontSize: 14, marginTop: 4 }}>{ev.fromPriceFormatted ? `From ${ev.fromPriceFormatted}` : 'Sold out'}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}
