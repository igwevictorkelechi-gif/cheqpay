import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { colors, Card } from '@/components/brand';
import {
  api,
  ApiError,
  type GadgetProduct,
  type GadgetDelivery,
  type GadgetDiscountQuote,
} from '@/services/api';
import { useTransactionPin, PIN_CANCELLED } from '@/components/TransactionPinProvider';

type Step = 'browse' | 'buy' | 'done';

const EMPTY: GadgetDelivery = { name: '', phone: '', address: '', city: '', state: '' };

export default function GadgetsScreen() {
  const insets = useSafeAreaInsets();
  const { authorize } = useTransactionPin();

  const [products, setProducts] = useState<GadgetProduct[] | null>(null);
  const [comingSoon, setComingSoon] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [step, setStep] = useState<Step>('browse');
  const [selected, setSelected] = useState<GadgetProduct | null>(null);
  const [qty, setQty] = useState(1);
  const [delivery, setDelivery] = useState<GadgetDelivery>(EMPTY);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [category, setCategory] = useState('');
  const [code, setCode] = useState('');
  const [quote, setQuote] = useState<GadgetDiscountQuote | null>(null);
  const [codeMsg, setCodeMsg] = useState<string | null>(null);
  const [applyingCode, setApplyingCode] = useState(false);

  useEffect(() => {
    api
      .getGadgets()
      .then(({ products }) => setProducts(products))
      .catch((e) => {
        if (e instanceof ApiError && e.status === 503) {
          setComingSoon(true);
          setProducts([]);
        } else {
          setError(e instanceof ApiError ? e.message : "Couldn't load the store.");
          setProducts([]);
        }
      });
  }, []);

  function openBuy(p: GadgetProduct) {
    setSelected(p);
    setQty(1);
    setDelivery(EMPTY);
    setNote('');
    setFormError(null);
    setCode('');
    setQuote(null);
    setCodeMsg(null);
    setStep('buy');
  }

  function changeQty(next: number) {
    setQty(Math.min(20, Math.max(1, next)));
    setQuote(null);
    setCodeMsg(null);
  }

  async function applyCode() {
    if (!selected || !code.trim()) return;
    setApplyingCode(true);
    setCodeMsg(null);
    try {
      const { quote: q } = await api.validateGadgetDiscount({
        code: code.trim(),
        productId: selected.id,
        quantity: qty,
      });
      setQuote(q);
      setCodeMsg(`Applied — you save ${q.discountFormatted}.`);
    } catch (e) {
      setQuote(null);
      setCodeMsg(e instanceof ApiError ? e.message : "Couldn't apply that code.");
    } finally {
      setApplyingCode(false);
    }
  }

  const deliveryComplete = Object.values(delivery).every((v) => v.trim().length > 0);

  async function pay() {
    if (!selected) return;
    if (!deliveryComplete) {
      setFormError('Fill in all delivery fields.');
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      await authorize(
        (pin) =>
          api.buyGadget(
            {
              productId: selected.id,
              quantity: qty,
              delivery,
              note: note.trim() || undefined,
              discountCode: quote?.code,
            },
            pin,
          ),
        { title: 'Confirm this order', detail: `${qty} × ${selected.name}` },
      );
      setStep('done');
    } catch (e) {
      if (e instanceof Error && e.message === PIN_CANCELLED) {
        setBusy(false);
        return;
      }
      setFormError(e instanceof ApiError ? e.message : "That didn't go through. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const field = (placeholder: string, key: keyof GadgetDelivery, keyboard: 'default' | 'phone-pad' = 'default') => (
    <TextInput
      placeholder={placeholder}
      placeholderTextColor={colors.muted}
      keyboardType={keyboard}
      value={delivery[key]}
      onChangeText={(t) => setDelivery((d) => ({ ...d, [key]: t }))}
      style={{
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 16,
        paddingHorizontal: 16,
        paddingVertical: 14,
        color: colors.ink,
        fontSize: 15,
        marginBottom: 10,
      }}
    />
  );

  // ---- Success ----
  if (step === 'done' && selected) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.surface, paddingTop: insets.top }}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
          <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="cube" size={40} color={colors.brandLight} />
          </View>
          <Text style={{ color: colors.ink, fontSize: 24, fontWeight: '800', marginTop: 24 }}>Order placed</Text>
          <Text style={{ color: colors.muted, fontSize: 14, textAlign: 'center', marginTop: 8, lineHeight: 20 }}>
            Your order for {qty} × {selected.name} is confirmed. We&apos;ll be in touch about delivery.
          </Text>
          <TouchableOpacity
            onPress={() => router.push('/(app)/gadget-orders')}
            style={{ marginTop: 32, backgroundColor: colors.brandLight, borderRadius: 999, paddingHorizontal: 40, paddingVertical: 14 }}
          >
            <Text style={{ color: colors.white, fontWeight: '800', fontSize: 16 }}>View my orders</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setStep('browse')} style={{ marginTop: 12 }}>
            <Text style={{ color: colors.muted, fontWeight: '600' }}>Keep shopping</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ---- Buy ----
  if (step === 'buy' && selected) {
    const total = (Number(selected.priceMinor) * qty) / 100;
    return (
      <View style={{ flex: 1, backgroundColor: colors.surface, paddingTop: insets.top }}>
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 48 }}>
          <TouchableOpacity
            onPress={() => setStep('browse')}
            style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' }}
          >
            <Ionicons name="arrow-back" size={20} color={colors.ink} />
          </TouchableOpacity>

          {selected.imageUrl ? (
            <Image source={{ uri: selected.imageUrl }} style={{ width: '100%', height: 190, borderRadius: 16, marginTop: 16 }} resizeMode="cover" />
          ) : null}
          <Text style={{ color: colors.ink, fontSize: 24, fontWeight: '800', marginTop: 16 }}>{selected.name}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
            <Text style={{ color: colors.brandLight, fontSize: 18, fontWeight: '700' }}>{selected.priceFormatted}</Text>
            {selected.compareAtFormatted ? (
              <Text style={{ color: colors.muted, fontSize: 14, marginLeft: 8, textDecorationLine: 'line-through' }}>
                {selected.compareAtFormatted}
              </Text>
            ) : null}
            {selected.discountPercent ? (
              <Text style={{ color: colors.brandLight, fontSize: 13, fontWeight: '800', marginLeft: 8 }}>Save {selected.discountPercent}%</Text>
            ) : null}
          </View>
          {selected.description ? (
            <Text style={{ color: colors.muted, fontSize: 14, lineHeight: 20, marginTop: 8 }}>{selected.description}</Text>
          ) : null}

          {selected.specs && selected.specs.length > 0 ? (
            <View style={{ marginTop: 20 }}>
              <Text style={{ color: colors.ink, fontSize: 18, fontWeight: '700', marginBottom: 8 }}>Specifications</Text>
              <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 16, overflow: 'hidden' }}>
                {selected.specs.map((s, i) => (
                  <View
                    key={i}
                    style={{
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                      gap: 12,
                      paddingHorizontal: 14,
                      paddingVertical: 12,
                      backgroundColor: i % 2 === 0 ? colors.card : 'transparent',
                    }}
                  >
                    <Text style={{ color: colors.muted, fontSize: 13, flexShrink: 1 }}>{s.label}</Text>
                    <Text style={{ color: colors.ink, fontSize: 13, fontWeight: '700', textAlign: 'right', flexShrink: 1 }}>{s.value}</Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 24 }}>
            <Text style={{ color: colors.ink, fontSize: 16, fontWeight: '600' }}>Quantity</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
              <TouchableOpacity onPress={() => changeQty(qty - 1)} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: colors.ink, fontSize: 20, fontWeight: '800' }}>−</Text>
              </TouchableOpacity>
              <Text style={{ color: colors.ink, fontSize: 18, fontWeight: '800', width: 24, textAlign: 'center' }}>{qty}</Text>
              <TouchableOpacity onPress={() => changeQty(qty + 1)} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: colors.ink, fontSize: 20, fontWeight: '800' }}>+</Text>
              </TouchableOpacity>
            </View>
          </View>

          <Text style={{ color: colors.ink, fontSize: 18, fontWeight: '700', marginTop: 28, marginBottom: 12 }}>Delivery details</Text>
          {field('Full name', 'name')}
          {field('Phone number', 'phone', 'phone-pad')}
          {field('Street address', 'address')}
          {field('City', 'city')}
          {field('State', 'state')}
          <TextInput
            placeholder="Note for delivery (optional)"
            placeholderTextColor={colors.muted}
            value={note}
            onChangeText={setNote}
            style={{ backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14, color: colors.ink, fontSize: 15 }}
          />

          <Text style={{ color: colors.ink, fontSize: 18, fontWeight: '700', marginTop: 28, marginBottom: 12 }}>Discount code</Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <TextInput
              placeholder="Enter code"
              placeholderTextColor={colors.muted}
              autoCapitalize="characters"
              value={code}
              onChangeText={(t) => { setCode(t.toUpperCase()); setQuote(null); setCodeMsg(null); }}
              style={{ flex: 1, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14, color: colors.ink, fontSize: 15 }}
            />
            <TouchableOpacity
              onPress={applyCode}
              disabled={!code.trim() || applyingCode}
              style={{ backgroundColor: colors.ink, borderRadius: 16, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center', opacity: !code.trim() || applyingCode ? 0.5 : 1 }}
            >
              <Text style={{ color: colors.white, fontWeight: '800' }}>{quote ? 'Applied' : 'Apply'}</Text>
            </TouchableOpacity>
          </View>
          {codeMsg ? (
            <Text style={{ color: quote ? colors.brandLight : '#F87171', fontSize: 13, marginTop: 8 }}>{codeMsg}</Text>
          ) : null}

          <View style={{ backgroundColor: colors.card, borderRadius: 16, padding: 16, marginTop: 20 }}>
            {quote ? (
              <>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: colors.muted, fontSize: 14 }}>Subtotal</Text>
                  <Text style={{ color: colors.muted, fontSize: 14 }}>{quote.subtotalFormatted}</Text>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
                  <Text style={{ color: colors.brandLight, fontSize: 14 }}>Discount ({quote.code})</Text>
                  <Text style={{ color: colors.brandLight, fontSize: 14 }}>−{quote.discountFormatted}</Text>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10 }}>
                  <Text style={{ color: colors.muted, fontSize: 14 }}>Total</Text>
                  <Text style={{ color: colors.ink, fontSize: 20, fontWeight: '800' }}>{quote.totalFormatted}</Text>
                </View>
              </>
            ) : (
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ color: colors.muted, fontSize: 14 }}>Total</Text>
                <Text style={{ color: colors.ink, fontSize: 20, fontWeight: '800' }}>
                  ₦{total.toLocaleString('en-NG', { maximumFractionDigits: 2 })}
                </Text>
              </View>
            )}
          </View>

          {formError ? (
            <Text style={{ color: '#F87171', fontSize: 13, marginTop: 12 }}>{formError}</Text>
          ) : null}

          <TouchableOpacity
            onPress={pay}
            disabled={busy}
            style={{ marginTop: 20, backgroundColor: colors.brandLight, borderRadius: 999, paddingVertical: 16, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8, opacity: busy ? 0.6 : 1 }}
          >
            {busy ? <ActivityIndicator color={colors.white} size="small" /> : null}
            <Text style={{ color: colors.white, fontSize: 16, fontWeight: '800' }}>
              {busy ? 'Placing order…' : 'Pay & order'}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  // ---- Browse ----
  const categories = Array.from(
    new Set((products ?? []).map((p) => p.category).filter(Boolean)),
  ).sort();
  const visibleProducts = (products ?? []).filter((p) => !category || p.category === category);

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface, paddingTop: insets.top }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 12 }}>
          <TouchableOpacity
            onPress={() => router.push('/(app)/pay-bill')}
            style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' }}
          >
            <Ionicons name="arrow-back" size={20} color={colors.ink} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push('/(app)/gadget-orders')} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Ionicons name="bag-outline" size={16} color={colors.brandLight} />
            <Text style={{ color: colors.brandLight, fontWeight: '600', fontSize: 14 }}>My orders</Text>
          </TouchableOpacity>
        </View>

        <Text style={{ color: colors.ink, fontSize: 32, fontWeight: '800', paddingHorizontal: 20, marginTop: 12 }}>Gadgets</Text>
        <Text style={{ color: colors.muted, fontSize: 14, paddingHorizontal: 20, marginTop: 4, marginBottom: 12 }}>
          Buy from CheqPay, delivered to you.
        </Text>

        {categories.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 20, gap: 8 }}
            style={{ marginBottom: 16 }}
          >
            {['', ...categories].map((c) => {
              const activeChip = category === c;
              return (
                <TouchableOpacity
                  key={c || 'all'}
                  onPress={() => setCategory(c)}
                  style={{
                    paddingHorizontal: 16,
                    paddingVertical: 8,
                    borderRadius: 999,
                    backgroundColor: activeChip ? colors.brandLight : colors.card,
                  }}
                >
                  <Text style={{ color: activeChip ? colors.white : colors.muted, fontWeight: '700', fontSize: 13 }}>
                    {c || 'All'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        ) : null}

        {products === null ? (
          <ActivityIndicator color={colors.muted} style={{ marginTop: 60 }} />
        ) : comingSoon ? (
          <View style={{ paddingHorizontal: 20 }}>
            <Card>
              <View style={{ paddingVertical: 24, alignItems: 'center' }}>
                <Text style={{ fontSize: 36 }}>🛍️</Text>
                <Text style={{ color: colors.ink, fontSize: 18, fontWeight: '700', marginTop: 12 }}>Coming soon</Text>
                <Text style={{ color: colors.muted, fontSize: 14, textAlign: 'center', marginTop: 4 }}>
                  The gadget store is almost ready. Check back shortly.
                </Text>
              </View>
            </Card>
          </View>
        ) : error ? (
          <View style={{ paddingHorizontal: 20 }}>
            <Card><Text style={{ color: colors.muted, textAlign: 'center', paddingVertical: 20 }}>{error}</Text></Card>
          </View>
        ) : products.length === 0 ? (
          <View style={{ paddingHorizontal: 20 }}>
            <Card><Text style={{ color: colors.muted, textAlign: 'center', paddingVertical: 28 }}>No gadgets are listed yet. Please check back soon.</Text></Card>
          </View>
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', paddingHorizontal: 20 }}>
            {visibleProducts.map((p) => (
              <TouchableOpacity
                key={p.id}
                activeOpacity={0.85}
                disabled={!p.available}
                onPress={() => openBuy(p)}
                style={{ width: '48%', backgroundColor: colors.card, borderRadius: 16, overflow: 'hidden', marginBottom: 12, opacity: p.available ? 1 : 0.6 }}
              >
                <View style={{ height: 120, backgroundColor: colors.circle, alignItems: 'center', justifyContent: 'center' }}>
                  {p.imageUrl ? (
                    <Image source={{ uri: p.imageUrl }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                  ) : (
                    <Ionicons name="cube-outline" size={36} color={colors.muted} />
                  )}
                </View>
                <View style={{ padding: 12 }}>
                  <Text numberOfLines={2} style={{ color: colors.ink, fontWeight: '700', fontSize: 14 }}>{p.name}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
                    <Text style={{ color: colors.brandLight, fontWeight: '800', fontSize: 14 }}>{p.priceFormatted}</Text>
                    {p.compareAtFormatted ? (
                      <Text style={{ color: colors.muted, fontSize: 12, marginLeft: 6, textDecorationLine: 'line-through' }}>
                        {p.compareAtFormatted}
                      </Text>
                    ) : null}
                  </View>
                  {p.discountPercent ? (
                    <Text style={{ color: colors.brandLight, fontSize: 11, fontWeight: '800', marginTop: 2 }}>Save {p.discountPercent}%</Text>
                  ) : null}
                  {!p.available ? <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '600', marginTop: 4 }}>Sold out</Text> : null}
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}
