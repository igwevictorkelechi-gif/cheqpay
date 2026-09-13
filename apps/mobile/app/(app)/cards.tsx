import { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { colors, TopBar } from '@/components/brand';
import { useAuthStore } from '@/store';
import { api, ApiError, type Balance, type VirtualCard } from '@/services/api';
import { useFeatures } from '@/lib/useFeatures';

/**
 * Virtual USD cards (Maplerad).
 *
 * Two gates cover the screen: the admin `virtual_cards` flag AND a configured
 * Maplerad key on the API — until both are on it shows "coming soon" rather
 * than creating a card.
 *
 * Within the screen, issuing a card and reading its status are wired end to
 * end; revealing its numbers, loading it and listing its spending are not,
 * because those Maplerad endpoints are still marked "inferred" in
 * lib/maplerad/issuing.ts. Each of those says so when tapped instead of
 * silently doing nothing.
 */

const AWAITING_PROVIDER = "We're finishing this with our card provider — not long now.";
const LOAD_AMOUNTS = [5, 10, 25, 50, 100];

export default function CardsScreen() {
  const insets = useSafeAreaInsets();
  const features = useFeatures();
  const { user } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [cards, setCards] = useState<VirtualCard[]>([]);
  const [available, setAvailable] = useState(false);
  const [usdBalance, setUsdBalance] = useState<Balance | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [{ cards, available }, balances] = await Promise.all([
          api.getCards(),
          api.getBalances().catch(() => ({ balances: [] as Balance[] })),
        ]);
        setCards(cards);
        setAvailable(available);
        setActiveId(cards[0]?.id ?? null);
        setUsdBalance(balances.balances.find((b) => b.asset === 'USD') ?? null);
      } catch {
        /* best-effort */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const activeCard = useMemo(
    () => cards.find((c) => c.id === activeId) ?? cards[0] ?? null,
    [cards, activeId],
  );

  async function createCard() {
    setError(null);
    setCreating(true);
    try {
      const { card } = await api.createCard();
      setCards((prev) => [card, ...prev]);
      setActiveId(card.id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Couldn’t create a card right now.');
    } finally {
      setCreating(false);
    }
  }

  const notReady = () => Alert.alert('Almost there', AWAITING_PROVIDER);
  const comingSoon = !features.virtual_cards || !available;

  return (
    <View className="flex-1" style={{ backgroundColor: colors.surface, paddingTop: insets.top }}>
      <TopBar
        name={user?.full_name}
        onAvatarPress={() => router.push('/(app)/profile')}
        icons={[{ name: 'search-outline' }, { name: 'notifications-outline' }]}
      />

      <Text
        className="text-ink dark:text-ink-dark font-extrabold px-5 mt-3"
        style={{ fontSize: 32 }}
      >
        Virtual cards
      </Text>

      {loading ? (
        <ActivityIndicator color={colors.muted} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 32 }}
          showsVerticalScrollIndicator={false}
        >
          <Text className="text-muted dark:text-muted-dark text-sm mt-1 mb-4">
            Dollar cards for online payments and subscriptions.
          </Text>

          {comingSoon ? (
            <EmptyState
              icon="card"
              tint={colors.brandLight}
              title="Coming soon"
              body="USD virtual cards are on the way. We’ll let you know the moment they’re ready."
            />
          ) : cards.length === 0 ? (
            <>
              <EmptyState
                icon="card-outline"
                tint={colors.muted}
                title="No cards yet"
                body="Create a virtual dollar card to pay online, subscribe and shop."
              />
              <CreateButton onPress={createCard} busy={creating} />
            </>
          ) : (
            <>
              {activeCard && (
                <CardWallet
                  card={activeCard}
                  stackCount={cards.length}
                  holder={user?.full_name ?? null}
                  onUnavailable={notReady}
                />
              )}

              {cards.length > 1 && (
                <View className="flex-row items-center justify-center mt-4" style={{ gap: 8 }}>
                  {cards.map((c) => (
                    <TouchableOpacity
                      key={c.id}
                      onPress={() => setActiveId(c.id)}
                      accessibilityLabel={`Show card ending ${c.maskedPan?.slice(-4) ?? ''}`}
                      style={{
                        height: 8,
                        width: c.id === activeCard?.id ? 24 : 8,
                        borderRadius: 4,
                        backgroundColor:
                          c.id === activeCard?.id ? colors.brandLight : colors.border,
                      }}
                    />
                  ))}
                </View>
              )}

              {usdBalance && (
                <Text
                  className="text-muted dark:text-muted-dark text-xs text-center"
                  style={{ marginTop: 12 }}
                >
                  <Text style={{ color: colors.ink, fontWeight: '700' }}>
                    {usdBalance.availableFormatted}
                  </Text>{' '}
                  in your dollar balance to load
                </Text>
              )}

              {/* Quick load — the card equivalent of a contacts row. */}
              <Text
                className="text-ink dark:text-ink-dark font-bold mt-8"
                style={{ fontSize: 18 }}
              >
                Quick load
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 12, paddingVertical: 12 }}
              >
                {LOAD_AMOUNTS.map((amount) => (
                  <TouchableOpacity
                    key={amount}
                    onPress={notReady}
                    className="items-center justify-center"
                    style={{
                      height: 76,
                      width: 76,
                      borderRadius: 16,
                      backgroundColor: colors.card,
                    }}
                  >
                    <Text style={{ color: colors.ink, fontSize: 18, fontWeight: '800' }}>
                      ${amount}
                    </Text>
                    <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>load</Text>
                  </TouchableOpacity>
                ))}
                <TouchableOpacity
                  onPress={notReady}
                  className="items-center justify-center"
                  style={{
                    height: 76,
                    width: 76,
                    borderRadius: 16,
                    borderWidth: 1,
                    borderStyle: 'dashed',
                    borderColor: colors.border,
                  }}
                >
                  <Ionicons name="add" size={20} color={colors.brandLight} />
                  <Text style={{ color: colors.brandLight, fontSize: 11, marginTop: 2 }}>
                    Other
                  </Text>
                </TouchableOpacity>
              </ScrollView>

              <Text
                className="text-ink dark:text-ink-dark font-bold mt-6"
                style={{ fontSize: 18 }}
              >
                Card activity
              </Text>
              <View
                className="items-center"
                style={{
                  marginTop: 12,
                  borderRadius: 16,
                  backgroundColor: colors.card,
                  paddingVertical: 32,
                  paddingHorizontal: 20,
                }}
              >
                <View
                  className="items-center justify-center"
                  style={{
                    height: 48,
                    width: 48,
                    borderRadius: 24,
                    backgroundColor: colors.circle,
                  }}
                >
                  <Ionicons name="lock-closed-outline" size={20} color={colors.muted} />
                </View>
                <Text style={{ color: colors.ink, fontWeight: '600', marginTop: 12 }}>
                  Nothing to show yet
                </Text>
                <Text
                  style={{
                    color: colors.muted,
                    fontSize: 12,
                    marginTop: 4,
                    textAlign: 'center',
                  }}
                >
                  Once your card is live, everything you spend on it appears here.
                </Text>
              </View>

              <CreateButton onPress={createCard} busy={creating} label="Create another card" />
            </>
          )}

          {error && <Text style={{ color: '#F87171', marginTop: 16 }}>{error}</Text>}
        </ScrollView>
      )}
    </View>
  );
}

/* ---------------------------------------------------------------------- */

function EmptyState({
  icon,
  tint,
  title,
  body,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  tint: string;
  title: string;
  body: string;
}) {
  return (
    <View className="items-center py-12">
      <View
        className="w-16 h-16 rounded-full items-center justify-center"
        style={{ backgroundColor: colors.card }}
      >
        <Ionicons name={icon} size={26} color={tint} />
      </View>
      <Text className="text-ink dark:text-ink-dark text-lg font-bold mt-4">{title}</Text>
      <Text className="text-muted dark:text-muted-dark text-sm mt-1 text-center px-6">{body}</Text>
    </View>
  );
}

function CreateButton({
  onPress,
  busy,
  label = 'Create a new card',
}: {
  onPress: () => void;
  busy: boolean;
  label?: string;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={busy}
      className="mt-6 flex-row items-center justify-center py-4 rounded-2xl"
      style={{
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: colors.border,
        opacity: busy ? 0.5 : 1,
      }}
    >
      {busy ? (
        <ActivityIndicator color={colors.brandLight} />
      ) : (
        <Ionicons name="add" size={20} color={colors.brandLight} />
      )}
      <Text style={{ color: colors.brandLight, fontWeight: '700', marginLeft: 8 }}>
        {busy ? 'Creating…' : label}
      </Text>
    </TouchableOpacity>
  );
}

/**
 * The card sits BEHIND a pocket panel that overlaps it, so only its top band —
 * name, brand, last four, expiry — shows, the way a card sits in a wallet.
 */
function CardWallet({
  card,
  stackCount,
  holder,
  onUnavailable,
}: {
  card: VirtualCard;
  stackCount: number;
  holder: string | null;
  onUnavailable: () => void;
}) {
  const frozen = card.status === 'frozen';
  const pending = card.status === 'pending';

  return (
    <View style={{ marginTop: 8 }}>
      {stackCount > 1 && (
        <View
          style={{
            height: 12,
            width: '86%',
            alignSelf: 'center',
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
            backgroundColor: colors.brandLight,
            opacity: 0.35,
          }}
        />
      )}

      {/* Card face. Bottom padding leaves room for the pocket to overlap. */}
      <View
        style={{
          borderRadius: 20,
          backgroundColor: colors.brandLight,
          paddingHorizontal: 20,
          paddingTop: 20,
          paddingBottom: 64,
        }}
      >
        <View className="flex-row items-start justify-between">
          <Text
            numberOfLines={1}
            style={{ color: colors.white, fontSize: 17, fontWeight: '700', maxWidth: '60%' }}
          >
            {holder ?? 'CheqPay card'}
          </Text>
          <Text
            style={{
              color: colors.white,
              fontSize: 18,
              fontWeight: '900',
              fontStyle: 'italic',
            }}
          >
            {card.brand ?? 'VISA'}
          </Text>
        </View>
        <View className="flex-row items-end justify-between" style={{ marginTop: 8 }}>
          <Text
            style={{
              color: colors.white,
              opacity: 0.9,
              fontSize: 14,
              letterSpacing: 3,
              fontVariant: ['tabular-nums'],
            }}
          >
            {card.maskedPan ?? '•••• •••• •••• ••••'}
          </Text>
          <Text style={{ color: colors.white, opacity: 0.8, fontSize: 11, fontWeight: '600' }}>
            Valid {card.status === 'active' ? '••/••' : '—'}
          </Text>
        </View>
      </View>

      {/* Pocket, overlapping the card. */}
      <View
        style={{
          marginTop: -40,
          borderRadius: 20,
          backgroundColor: colors.brand,
          padding: 6,
        }}
      >
        <View
          style={{
            borderRadius: 14,
            borderWidth: 2,
            borderStyle: 'dashed',
            borderColor: 'rgba(255,255,255,0.25)',
            paddingHorizontal: 16,
            paddingVertical: 16,
          }}
        >
          <View className="flex-row items-center justify-between">
            <Text
              style={{
                color: colors.white,
                opacity: 0.7,
                fontSize: 11,
                fontWeight: '600',
                textTransform: 'uppercase',
                letterSpacing: 0.5,
              }}
            >
              Card balance
            </Text>
            {(frozen || pending) && (
              <View
                className="flex-row items-center px-2 py-0.5 rounded-full"
                style={{ backgroundColor: 'rgba(0,0,0,0.25)' }}
              >
                <Ionicons name={frozen ? 'snow' : 'time-outline'} size={11} color={colors.white} />
                <Text style={{ color: colors.white, fontSize: 11, marginLeft: 4 }}>
                  {card.status}
                </Text>
              </View>
            )}
          </View>

          {/* No balance until the provider reports one — $0.00 would read as
              "empty card" rather than "not known yet". */}
          <Text style={{ color: colors.white, fontSize: 32, fontWeight: '800', marginTop: 4 }}>
            <Text style={{ opacity: 0.6 }}>$</Text>—
          </Text>
          <Text style={{ color: colors.white, opacity: 0.6, fontSize: 11, marginTop: 6 }}>
            Balance shown once the card is live
          </Text>

          <View className="flex-row items-center" style={{ marginTop: 16, gap: 8 }}>
            <TouchableOpacity
              onPress={onUnavailable}
              className="flex-1 flex-row items-center justify-center"
              style={{
                borderRadius: 999,
                backgroundColor: 'rgba(255,255,255,0.15)',
                paddingVertical: 12,
              }}
            >
              <Ionicons name="add" size={16} color={colors.white} />
              <Text
                style={{ color: colors.white, fontWeight: '700', fontSize: 14, marginLeft: 6 }}
              >
                Add money
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={onUnavailable}
              accessibilityLabel="Show card details"
              className="items-center justify-center"
              style={{
                height: 44,
                width: 44,
                borderRadius: 22,
                backgroundColor: 'rgba(255,255,255,0.15)',
              }}
            >
              <Ionicons name="eye-outline" size={17} color={colors.white} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={onUnavailable}
              accessibilityLabel={frozen ? 'Unfreeze card' : 'Freeze card'}
              className="items-center justify-center"
              style={{
                height: 44,
                width: 44,
                borderRadius: 22,
                backgroundColor: 'rgba(255,255,255,0.15)',
              }}
            >
              <Ionicons name={frozen ? 'sunny-outline' : 'snow-outline'} size={17} color={colors.white} />
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </View>
  );
}
