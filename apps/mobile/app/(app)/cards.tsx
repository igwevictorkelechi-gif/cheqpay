import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { colors } from '@/components/brand';
import { api, ApiError, type VirtualCard } from '@/services/api';
import { useFeatures } from '@/lib/useFeatures';

/**
 * Virtual USD cards (Maplerad). Gated by the admin `virtual_cards` flag AND a
 * configured Maplerad key on the API — until both are on the screen shows a
 * friendly "coming soon" state instead of creating a card.
 */
export default function CardsScreen() {
  const insets = useSafeAreaInsets();
  const features = useFeatures();
  const [loading, setLoading] = useState(true);
  const [cards, setCards] = useState<VirtualCard[]>([]);
  const [available, setAvailable] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { cards, available } = await api.getCards();
        setCards(cards);
        setAvailable(available);
      } catch {
        /* best-effort */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function createCard() {
    setError(null);
    setCreating(true);
    try {
      const { card } = await api.createCard();
      setCards((prev) => [card, ...prev]);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Couldn’t create a card right now.');
    } finally {
      setCreating(false);
    }
  }

  const comingSoon = !features.virtual_cards || !available;

  return (
    <View className="flex-1" style={{ backgroundColor: colors.surface, paddingTop: insets.top }}>
      <View className="flex-row items-center px-5 pt-3 pb-2">
        <TouchableOpacity
          onPress={() => router.back()}
          className="w-10 h-10 rounded-full bg-card items-center justify-center"
        >
          <Ionicons name="chevron-back" size={22} color={colors.ink} />
        </TouchableOpacity>
        <Text className="text-ink text-lg font-bold ml-3">Virtual cards</Text>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.muted} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 32 }}>
          <Text className="text-muted text-sm mt-1 mb-4">
            Dollar cards for online payments, subscriptions and shopping.
          </Text>

          {comingSoon ? (
            <View className="items-center py-12">
              <View
                className="w-16 h-16 rounded-full items-center justify-center"
                style={{ backgroundColor: colors.card }}
              >
                <Ionicons name="card" size={26} color={colors.brandLight} />
              </View>
              <Text className="text-ink text-lg font-bold mt-4">Coming soon</Text>
              <Text className="text-muted text-sm mt-1 text-center px-6">
                USD virtual cards are on the way. We’ll let you know the moment they’re ready.
              </Text>
            </View>
          ) : (
            <>
              {cards.length === 0 ? (
                <View className="items-center py-10">
                  <View
                    className="w-16 h-16 rounded-full items-center justify-center"
                    style={{ backgroundColor: colors.card }}
                  >
                    <Ionicons name="card-outline" size={26} color={colors.muted} />
                  </View>
                  <Text className="text-ink font-bold mt-4">No cards yet</Text>
                  <Text className="text-muted text-sm mt-1 text-center px-6">
                    Create a virtual dollar card to pay online.
                  </Text>
                </View>
              ) : (
                <View style={{ gap: 16 }}>
                  {cards.map((c) => (
                    <View
                      key={c.id}
                      style={{
                        borderRadius: 20,
                        padding: 20,
                        backgroundColor: colors.brand,
                      }}
                    >
                      <View className="flex-row items-center justify-between">
                        <Text style={{ color: colors.white, fontWeight: '600', opacity: 0.85 }}>
                          {c.currency} Virtual
                        </Text>
                        {c.status !== 'active' && (
                          <View
                            className="flex-row items-center px-2 py-0.5 rounded-full"
                            style={{ backgroundColor: 'rgba(0,0,0,0.25)' }}
                          >
                            <Ionicons name="snow" size={11} color={colors.white} />
                            <Text style={{ color: colors.white, fontSize: 11, marginLeft: 4 }}>
                              {c.status}
                            </Text>
                          </View>
                        )}
                      </View>
                      <Text
                        style={{
                          color: colors.white,
                          fontSize: 18,
                          letterSpacing: 3,
                          marginTop: 32,
                          fontVariant: ['tabular-nums'],
                        }}
                      >
                        {c.maskedPan ?? '•••• •••• •••• ••••'}
                      </Text>
                      <Text
                        style={{
                          color: colors.white,
                          opacity: 0.7,
                          fontSize: 11,
                          marginTop: 8,
                          textTransform: 'uppercase',
                        }}
                      >
                        {c.brand ?? 'CheqPay'}
                      </Text>
                    </View>
                  ))}
                </View>
              )}

              {error && <Text style={{ color: '#F87171', marginTop: 16 }}>{error}</Text>}

              <TouchableOpacity
                onPress={createCard}
                disabled={creating}
                className="mt-6 flex-row items-center justify-center py-4 rounded-2xl"
                style={{ borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border, opacity: creating ? 0.5 : 1 }}
              >
                {creating ? (
                  <ActivityIndicator color={colors.brandLight} />
                ) : (
                  <Ionicons name="add" size={20} color={colors.brandLight} />
                )}
                <Text style={{ color: colors.brandLight, fontWeight: '700', marginLeft: 8 }}>
                  {creating ? 'Creating…' : 'Create a new card'}
                </Text>
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}
