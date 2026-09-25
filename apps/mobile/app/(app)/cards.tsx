import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Modal,
  TextInput,
  Clipboard,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { colors, TopBar } from '@/components/brand';
import { useAuthStore } from '@/store';
import {
  api,
  ApiError,
  type Balance,
  type CardTransaction,
  type VirtualCard,
} from '@/services/api';
import { useFeatures } from '@/lib/useFeatures';
import { useTransactionPin, PIN_CANCELLED } from '@/components/TransactionPinProvider';
import { cardFundBreakdown, cardFundFeeText, dollars, useFees } from '@/lib/fees';

/**
 * Virtual USD cards (Maplerad). Two gates cover the screen: the admin
 * virtual_cards flag AND a configured Maplerad key. Everything on the card is
 * real: live balance, Add money / Withdraw between the in-app balance and the
 * card, Reveal (behind step-up 2FA), Freeze, and the card's own activity.
 */

const usd = (cents?: string | null): string | null =>
  cents == null || !Number.isFinite(Number(cents))
    ? null
    : `$${(Number(cents) / 100).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;

const QUICK = ['5', '10', '25', '50', '100'];

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
  const fees = useFees();

  const activeCard = useMemo(
    () => cards.find((c) => c.id === activeId) ?? cards[0] ?? null,
    [cards, activeId],
  );

  const refreshUsd = useCallback(async () => {
    try {
      const { balances } = await api.getBalances();
      setUsdBalance(balances.find((b) => b.asset === 'USD') ?? null);
    } catch {
      /* keep last known */
    }
  }, []);

  const refreshCard = useCallback(async (id: string) => {
    try {
      const { card } = await api.getCard(id);
      setCards((prev) => prev.map((c) => (c.id === id ? { ...c, ...card } : c)));
    } catch {
      /* keep the row */
    }
  }, []);

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

  useEffect(() => {
    if (activeCard?.id) void refreshCard(activeCard.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCard?.id]);

  /** A card costs money, so asking for one confirms the price first. */
  function createCard() {
    setError(null);
    const price = fees ? dollars(fees.cardIssueFeeUsd) : null;
    Alert.alert(
      'Create a virtual card',
      price
        ? `The card costs ${price}, paid from your USD balance${
            usdBalance ? ` ($${usdBalance.availableFormatted} available)` : ''
          }. If it can't be issued, the price is refunded automatically.`
        : 'The card price is paid from your USD balance.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: price ? `Pay ${price} & create` : 'Create', onPress: () => void doCreateCard() },
      ],
    );
  }

  async function doCreateCard() {
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

  const comingSoon = !features.virtual_cards || !available;

  return (
    <View className="flex-1" style={{ backgroundColor: colors.surface, paddingTop: insets.top }}>
      <TopBar
        name={user?.full_name}
        onAvatarPress={() => router.push('/(app)/profile')}
        icons={[{ name: 'search-outline' }, { name: 'notifications-outline' }]}
      />

      <Text className="text-ink dark:text-ink-dark font-extrabold px-5 mt-3" style={{ fontSize: 32 }}>
        Virtual cards
      </Text>

      {loading ? (
        <ActivityIndicator color={colors.muted} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 32 }}
          showsVerticalScrollIndicator={false}
        >
          <Text className="text-muted dark:text-muted-dark text-sm mt-1">
            Dollar cards for online payments and subscriptions.
          </Text>
          <Text className="text-muted dark:text-muted-dark text-xs mt-1 mb-4">
            {fees
              ? `Card ${dollars(fees.cardIssueFeeUsd)} · top-up ${cardFundFeeText(fees)} · withdrawal ${dollars(fees.cardWithdrawFeeUsd)}`
              : ' '}
          </Text>

          {comingSoon ? (
            <EmptyState
              icon="card"
              tint={colors.brandLight}
              title="Coming soon"
              body="USD virtual cards are on the way. We’ll let you know the moment they’re ready."
            />
          ) : (
            <>
              {/* The wallet shell renders with or without a card: before the
                  first one is issued it is a placeholder whose pocket action is
                  "Create your first card", so this reads as a wallet from the
                  first visit rather than an empty screen. */}
              <CardPocket
                card={activeCard}
                stackCount={cards.length}
                holder={user?.full_name ?? null}
                usdAvailable={usdBalance?.availableFormatted ?? null}
                creating={creating}
                onCreate={createCard}
                onFunded={async () => {
                  if (!activeCard) return;
                  await Promise.all([refreshCard(activeCard.id), refreshUsd()]);
                }}
                onFrozen={(status) =>
                  setCards((prev) =>
                    prev.map((c) => (c.id === activeCard?.id ? { ...c, status } : c)),
                  )
                }
              />

              {cards.length > 1 && (
                <View className="flex-row items-center justify-center mt-4" style={{ gap: 8 }}>
                  {cards.map((c) => (
                    <TouchableOpacity
                      key={c.id}
                      onPress={() => setActiveId(c.id)}
                      style={{
                        height: 8,
                        width: c.id === activeCard?.id ? 24 : 8,
                        borderRadius: 4,
                        backgroundColor: c.id === activeCard?.id ? colors.brandLight : colors.border,
                      }}
                    />
                  ))}
                </View>
              )}

              <CardActivity cardId={activeCard?.id ?? null} />

              {cards.length > 0 && (
                <CreateButton onPress={createCard} busy={creating} label="Create another card" />
              )}
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

function CardPocket({
  card,
  stackCount,
  holder,
  usdAvailable,
  creating,
  onCreate,
  onFunded,
  onFrozen,
}: {
  card: VirtualCard | null;
  stackCount: number;
  holder: string | null;
  usdAvailable: string | null;
  creating: boolean;
  onCreate: () => void;
  onFunded: () => Promise<void>;
  onFrozen: (status: string) => void;
}) {
  const frozen = card?.status === 'frozen';
  const pending = card?.status === 'pending';
  const active = card?.status === 'active';
  const balance = usd(card?.balanceMinor);

  const [sheet, setSheet] = useState<null | 'fund' | 'withdraw'>(null);
  const [prefill, setPrefill] = useState('');
  const [revealed, setRevealed] = useState<{ number: string | null; cvv: string | null; expiry: string | null } | null>(
    null,
  );
  const [revealing, setRevealing] = useState(false);
  const { authorize } = useTransactionPin();
  const [freezing, setFreezing] = useState(false);

  function openSheet(mode: 'fund' | 'withdraw', amount = '') {
    setPrefill(amount);
    setSheet(mode);
  }

  async function reveal() {
    if (!card) return;
    if (revealed) {
      setRevealed(null);
      return;
    }
    setRevealing(true);
    try {
      const { card: c } = await authorize((pin) => api.revealCard(card.id, pin), {
        title: 'Show card details',
        detail: 'Enter your transaction PIN to see the full card number and CVV.',
      });
      setRevealed({ number: c.number, cvv: c.cvv, expiry: c.expiry });
    } catch (e) {
      if (e instanceof Error && e.message === PIN_CANCELLED) return;
      Alert.alert(
        'Card details',
        e instanceof ApiError && e.status === 403
          ? 'Turn on two-factor authentication to reveal card details.'
          : e instanceof ApiError
            ? e.message
            : 'Couldn’t reveal the card right now.',
      );
    } finally {
      setRevealing(false);
    }
  }

  async function toggleFreeze() {
    if (!card) return;
    setFreezing(true);
    try {
      const { status } = await api.setCardFrozen(card.id, !frozen);
      onFrozen(status);
    } catch (e) {
      Alert.alert('Card', e instanceof ApiError ? e.message : 'Couldn’t update the card.');
    } finally {
      setFreezing(false);
    }
  }

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

      {/* Card face. */}
      <View
        style={{
          borderRadius: 20,
          backgroundColor: colors.brandLight,
          paddingHorizontal: 20,
          paddingTop: 20,
          paddingBottom: 64,
        }}
      >
        {/* Brand and card type. The supplied logo artwork is a purple wordmark
            on a light ground and would disappear on this purple face, so the
            card carries the name set in white — the way a card face normally
            carries a brand. */}
        <View className="flex-row items-start justify-between">
          <Text style={{ color: colors.white, fontSize: 17, fontWeight: '800', letterSpacing: -0.3 }}>
            CheqPay
          </Text>
          <View
            style={{
              borderRadius: 999,
              backgroundColor: 'rgba(255,255,255,0.2)',
              paddingHorizontal: 10,
              paddingVertical: 4,
            }}
          >
            <Text
              style={{
                color: colors.white,
                fontSize: 10,
                fontWeight: '700',
                textTransform: 'uppercase',
                letterSpacing: 1,
              }}
            >
              {card?.currency ?? 'USD'} Virtual
            </Text>
          </View>
        </View>

        <Text
          style={{
            color: colors.white,
            opacity: 0.95,
            fontSize: 15,
            letterSpacing: 2.5,
            marginTop: 16,
            fontVariant: ['tabular-nums'],
          }}
        >
          {revealed?.number
            ? revealed.number.replace(/(.{4})/g, '$1 ').trim()
            : (card?.maskedPan ?? '•••• •••• •••• ••••')}
        </Text>

        <View className="flex-row items-end justify-between" style={{ marginTop: 12 }}>
          <View style={{ flexShrink: 1 }}>
            <Text style={{ color: colors.white, opacity: 0.6, fontSize: 9, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1 }}>
              Card holder
            </Text>
            <Text numberOfLines={1} style={{ color: colors.white, fontSize: 13, fontWeight: '700', maxWidth: 180 }}>
              {holder ?? '—'}
            </Text>
          </View>
          <View className="flex-row items-end" style={{ gap: 16 }}>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={{ color: colors.white, opacity: 0.6, fontSize: 9, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1 }}>
                Valid thru
              </Text>
              <Text style={{ color: colors.white, fontSize: 13, fontWeight: '700' }}>
                {revealed?.expiry ?? (active ? '••/••' : '—')}
              </Text>
            </View>
            <Text style={{ color: colors.white, fontSize: 18, fontWeight: '900', fontStyle: 'italic' }}>
              {card?.brand ?? 'VISA'}
            </Text>
          </View>
        </View>
        {revealed?.cvv && (
          <View className="flex-row items-center" style={{ marginTop: 12, gap: 16 }}>
            <TouchableOpacity
              onPress={() => {
                Clipboard.setString(revealed.number?.replace(/\s/g, '') ?? '');
                Alert.alert('Copied', 'Card number copied.');
              }}
              className="flex-row items-center px-2.5 py-1 rounded-full"
              style={{ backgroundColor: 'rgba(255,255,255,0.15)' }}
            >
              <Ionicons name="copy-outline" size={12} color={colors.white} />
              <Text style={{ color: colors.white, fontSize: 12, fontWeight: '600', marginLeft: 4 }}>
                Copy number
              </Text>
            </TouchableOpacity>
            <Text style={{ color: colors.white, fontSize: 12, fontWeight: '600', opacity: 0.9 }}>
              CVV {revealed.cvv}
            </Text>
          </View>
        )}
      </View>

      {/* Pocket. */}
      <View style={{ marginTop: -40, borderRadius: 20, backgroundColor: colors.brand, padding: 6 }}>
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
              <View className="flex-row items-center px-2 py-0.5 rounded-full" style={{ backgroundColor: 'rgba(0,0,0,0.25)' }}>
                <Ionicons name={frozen ? 'snow' : 'time-outline'} size={11} color={colors.white} />
                <Text style={{ color: colors.white, fontSize: 11, marginLeft: 4 }}>{card?.status}</Text>
              </View>
            )}
          </View>

          <Text style={{ color: colors.white, fontSize: 32, fontWeight: '800', marginTop: 4 }}>
            {balance ?? <Text style={{ opacity: 0.6 }}>$—</Text>}
          </Text>
          <Text style={{ color: colors.white, opacity: 0.6, fontSize: 11, marginTop: 6 }}>
            {!card
              ? 'Create a card to start spending online'
              : balance
                ? usdAvailable
                  ? `${usdAvailable} available to load`
                  : ' '
                : 'Balance appears once the card is active'}
          </Text>

          {/* No card yet — the pocket's action is to make one. */}
          {!card ? (
            <TouchableOpacity
              onPress={onCreate}
              disabled={creating}
              className="flex-row items-center justify-center"
              style={{
                marginTop: 16,
                borderRadius: 999,
                backgroundColor: 'rgba(255,255,255,0.15)',
                paddingVertical: 12,
                opacity: creating ? 0.5 : 1,
              }}
            >
              {creating ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <Ionicons name="add" size={16} color={colors.white} />
              )}
              <Text style={{ color: colors.white, fontWeight: '700', fontSize: 14, marginLeft: 6 }}>
                {creating ? 'Creating…' : 'Create virtual card'}
              </Text>
            </TouchableOpacity>
          ) : (
            <View className="flex-row items-center" style={{ marginTop: 16, gap: 8 }}>
              <TouchableOpacity
                onPress={() => openSheet('fund')}
                disabled={!active}
                className="flex-1 flex-row items-center justify-center"
                style={{ borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.15)', paddingVertical: 12, opacity: active ? 1 : 0.5 }}
              >
                <Ionicons name="add" size={16} color={colors.white} />
                <Text style={{ color: colors.white, fontWeight: '700', fontSize: 14, marginLeft: 6 }}>Add money</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => openSheet('withdraw')}
                disabled={!active}
                style={{ borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.15)', paddingVertical: 12, paddingHorizontal: 14, opacity: active ? 1 : 0.5 }}
              >
                <Text style={{ color: colors.white, fontWeight: '700', fontSize: 14 }}>Withdraw</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={reveal}
                disabled={!active || revealing}
                accessibilityLabel={revealed ? 'Hide card details' : 'Show card details'}
                className="items-center justify-center"
                style={{ height: 44, width: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.15)', opacity: active ? 1 : 0.5 }}
              >
                {revealing ? (
                  <ActivityIndicator color={colors.white} />
                ) : (
                  <Ionicons name={revealed ? 'eye-off-outline' : 'eye-outline'} size={17} color={colors.white} />
                )}
              </TouchableOpacity>
              <TouchableOpacity
                onPress={toggleFreeze}
                disabled={pending || freezing}
                accessibilityLabel={frozen ? 'Unfreeze card' : 'Freeze card'}
                className="items-center justify-center"
                style={{ height: 44, width: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.15)', opacity: pending ? 0.5 : 1 }}
              >
                {freezing ? (
                  <ActivityIndicator color={colors.white} />
                ) : (
                  <Ionicons name={frozen ? 'sunny-outline' : 'snow-outline'} size={17} color={colors.white} />
                )}
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>

      {/* Quick load — the card's answer to the reference's contact row. */}
      <Text className="text-ink dark:text-ink-dark font-bold" style={{ fontSize: 18, marginTop: 28 }}>
        Quick load
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 12, paddingVertical: 12 }}
      >
        {QUICK.map((amount) => (
          <TouchableOpacity
            key={amount}
            onPress={() => openSheet('fund', amount)}
            disabled={!active}
            className="items-center justify-center"
            style={{ height: 76, width: 76, borderRadius: 16, backgroundColor: colors.card, opacity: active ? 1 : 0.4 }}
          >
            <Text style={{ color: colors.ink, fontSize: 18, fontWeight: '800' }}>${amount}</Text>
            <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>load</Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity
          onPress={() => openSheet('fund')}
          disabled={!active}
          className="items-center justify-center"
          style={{
            height: 76,
            width: 76,
            borderRadius: 16,
            borderWidth: 1,
            borderStyle: 'dashed',
            borderColor: colors.border,
            opacity: active ? 1 : 0.4,
          }}
        >
          <Ionicons name="add" size={20} color={colors.brandLight} />
          <Text style={{ color: colors.brandLight, fontSize: 11, marginTop: 2 }}>Other</Text>
        </TouchableOpacity>
      </ScrollView>

      <AmountSheet
        visible={sheet !== null && card !== null}
        mode={sheet ?? 'fund'}
        cardId={card?.id ?? ''}
        initialAmount={prefill}
        cardBalance={balance}
        usdAvailable={usdAvailable}
        onClose={() => setSheet(null)}
        onDone={async () => {
          setSheet(null);
          await onFunded();
        }}
      />
    </View>
  );
}

function AmountSheet({
  visible,
  mode,
  cardId,
  initialAmount,
  cardBalance,
  usdAvailable,
  onClose,
  onDone,
}: {
  visible: boolean;
  mode: 'fund' | 'withdraw';
  cardId: string;
  initialAmount: string;
  cardBalance: string | null;
  usdAvailable: string | null;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const { authorize } = useTransactionPin();
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const isFund = mode === 'fund';
  const fees = useFees();
  const value = Number(amount || 0);
  // Top-up: the card gets the amount, the fee is added on top.
  // Withdrawal: the fee comes out, the wallet gets the rest.
  const fund = fees && value > 0 ? cardFundBreakdown(value, fees) : null;
  const wdFee = fees ? fees.cardWithdrawFeeUsd : null;
  const wdReceive = wdFee !== null ? Math.round((value - wdFee) * 100) / 100 : null;

  useEffect(() => {
    if (visible) {
      setAmount(initialAmount);
      setErr(null);
    }
  }, [visible, mode, initialAmount]);

  async function submit() {
    setErr(null);
    if (!/^\d+(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) {
      setErr('Enter an amount like 10 or 10.50');
      return;
    }
    if (isFund && fund?.belowMin) {
      setErr(`The smallest top-up is ${dollars(fees!.cardFundMinUsd)}.`);
      return;
    }
    if (!isFund && wdReceive !== null && wdReceive <= 0) {
      setErr(`That doesn't cover the ${dollars(wdFee!)} withdrawal fee.`);
      return;
    }
    setBusy(true);
    try {
      await authorize(
        (pin) =>
          isFund
            ? api.fundCard(cardId, amount, pin)
            : api.withdrawFromCard(cardId, amount, pin),
        {
          title: isFund ? 'Confirm this card load' : 'Confirm this card withdrawal',
          detail: isFund
            ? fund
              ? `Loading ${dollars(fund.amount)} onto the card. ${dollars(fund.total)} leaves your balance (${dollars(fund.fee)} fee).`
              : `Moving $${amount} from your balance onto the card.`
            : wdReceive !== null
              ? `Moving $${amount} off the card. ${dollars(wdReceive)} reaches your balance (${dollars(wdFee!)} fee).`
              : `Moving $${amount} from the card back to your balance.`,
        },
      );
      await onDone();
    } catch (e) {
      if (e instanceof Error && e.message === PIN_CANCELLED) return;
      setErr(e instanceof ApiError ? e.message : 'That didn’t go through. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity
        activeOpacity={1}
        onPress={onClose}
        style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' }}
      >
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => {}}
          style={{
            backgroundColor: colors.surface,
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            padding: 20,
            paddingBottom: 36,
          }}
        >
          <View className="flex-row items-center justify-between" style={{ marginBottom: 16 }}>
            <Text style={{ color: colors.ink, fontSize: 18, fontWeight: '700' }}>
              {isFund ? 'Add money to card' : 'Withdraw from card'}
            </Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={22} color={colors.muted} />
            </TouchableOpacity>
          </View>

          <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 8 }}>
            {isFund
              ? `From your dollar balance${usdAvailable ? ` · ${usdAvailable} available` : ''}`
              : `To your dollar balance${cardBalance ? ` · ${cardBalance} on card` : ''}`}
          </Text>

          <View
            className="flex-row items-center"
            style={{ backgroundColor: colors.card, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 12 }}
          >
            <Text style={{ fontSize: 24, fontWeight: '800', color: colors.muted }}>$</Text>
            <TextInput
              autoFocus
              keyboardType="decimal-pad"
              value={amount}
              onChangeText={setAmount}
              placeholder="0.00"
              placeholderTextColor={colors.muted}
              style={{ flex: 1, fontSize: 24, fontWeight: '800', color: colors.ink, paddingLeft: 6 }}
            />
          </View>

          <View className="flex-row" style={{ marginTop: 12, gap: 8, flexWrap: 'wrap' }}>
            {QUICK.map((a) => (
              <TouchableOpacity
                key={a}
                onPress={() => setAmount(a)}
                style={{ backgroundColor: colors.card, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 8 }}
              >
                <Text style={{ color: colors.ink, fontWeight: '700', fontSize: 14 }}>${a}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* The fee and what actually moves, before the PIN. */}
          {fees && value > 0 ? (
            <View style={{ marginTop: 16, borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: 14, gap: 8 }}>
              {isFund && fund ? (
                <>
                  <View className="flex-row justify-between">
                    <Text style={{ color: colors.muted }}>Card receives</Text>
                    <Text style={{ color: colors.muted }}>{dollars(fund.amount)}</Text>
                  </View>
                  <View className="flex-row justify-between">
                    <Text style={{ color: colors.muted }}>Fee</Text>
                    <Text style={{ color: colors.muted }}>+{dollars(fund.fee)}</Text>
                  </View>
                  <View className="flex-row justify-between">
                    <Text style={{ color: colors.ink, fontWeight: '700' }}>Total from your balance</Text>
                    <Text style={{ color: colors.ink, fontWeight: '700' }}>{dollars(fund.total)}</Text>
                  </View>
                  {fund.belowMin ? (
                    <Text style={{ color: '#F87171', fontSize: 12 }}>
                      The smallest top-up is {dollars(fees.cardFundMinUsd)}.
                    </Text>
                  ) : null}
                </>
              ) : wdFee !== null && wdReceive !== null ? (
                <>
                  <View className="flex-row justify-between">
                    <Text style={{ color: colors.muted }}>Fee</Text>
                    <Text style={{ color: colors.muted }}>−{dollars(wdFee)}</Text>
                  </View>
                  <View className="flex-row justify-between">
                    <Text style={{ color: colors.ink, fontWeight: '700' }}>You'll receive</Text>
                    <Text style={{ color: colors.ink, fontWeight: '700' }}>{wdReceive > 0 ? dollars(wdReceive) : '—'}</Text>
                  </View>
                </>
              ) : null}
            </View>
          ) : null}

          {err && <Text style={{ color: '#F87171', marginTop: 12 }}>{err}</Text>}

          <TouchableOpacity
            onPress={submit}
            disabled={busy}
            className="flex-row items-center justify-center"
            style={{ marginTop: 20, backgroundColor: colors.brand, borderRadius: 16, paddingVertical: 16, opacity: busy ? 0.5 : 1 }}
          >
            {busy ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Ionicons name="checkmark" size={18} color={colors.white} />
            )}
            <Text style={{ color: colors.white, fontWeight: '700', marginLeft: 8 }}>
              {busy ? 'Working…' : isFund ? 'Add money' : 'Withdraw'}
            </Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

function CardActivity({ cardId }: { cardId: string }) {
  const [txns, setTxns] = useState<CardTransaction[] | null>(null);

  useEffect(() => {
    let active = true;
    setTxns(null);
    api
      .getCardTransactions(cardId)
      .then(({ transactions }) => active && setTxns(transactions))
      .catch(() => active && setTxns([]));
    return () => {
      active = false;
    };
  }, [cardId]);

  return (
    <View style={{ marginTop: 32 }}>
      <Text className="text-ink dark:text-ink-dark font-bold" style={{ fontSize: 18 }}>
        Card activity
      </Text>
      {txns === null ? (
        <ActivityIndicator color={colors.muted} style={{ marginTop: 16 }} />
      ) : txns.length === 0 ? (
        <View
          className="items-center"
          style={{ marginTop: 12, borderRadius: 16, backgroundColor: colors.card, paddingVertical: 32, paddingHorizontal: 20 }}
        >
          <View
            className="items-center justify-center"
            style={{ height: 48, width: 48, borderRadius: 24, backgroundColor: colors.circle }}
          >
            <Ionicons name="lock-closed-outline" size={20} color={colors.muted} />
          </View>
          <Text style={{ color: colors.ink, fontWeight: '600', marginTop: 12 }}>Nothing to show yet</Text>
          <Text style={{ color: colors.muted, fontSize: 12, marginTop: 4, textAlign: 'center' }}>
            Everything you spend on this card will appear here.
          </Text>
        </View>
      ) : (
        <View style={{ marginTop: 12, borderRadius: 16, backgroundColor: colors.card, overflow: 'hidden' }}>
          {txns.map((t, i) => {
            const credit = t.entry === 'CREDIT';
            const amt = t.amountMinor
              ? `${credit ? '+' : '-'}$${(Number(t.amountMinor) / 100).toFixed(2)}`
              : '—';
            return (
              <View
                key={t.id}
                className="flex-row items-center justify-between"
                style={{
                  paddingHorizontal: 16,
                  paddingVertical: 12,
                  borderTopWidth: i === 0 ? 0 : 1,
                  borderTopColor: colors.border,
                }}
              >
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text numberOfLines={1} style={{ color: colors.ink, fontSize: 14, fontWeight: '600' }}>
                    {t.merchant ?? t.description ?? 'Transaction'}
                  </Text>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>
                    {t.createdAt ? new Date(t.createdAt).toLocaleDateString() : ''}
                    {t.status ? ` · ${t.status}` : ''}
                  </Text>
                </View>
                <Text style={{ color: credit ? colors.positive : colors.ink, fontSize: 14, fontWeight: '700' }}>
                  {amt}
                </Text>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}
