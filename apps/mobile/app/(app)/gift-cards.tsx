import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { colors, Card } from '@/components/brand';
import { api, ApiError, type GiftCardBrand, type GiftCardRate, type GiftCardTrade } from '@/services/api';

const TILE_COLORS = ['#F59E0B', '#6B5B95', '#2563EB', '#16A34A', '#DC2626', '#0EA5A0', '#DB2777', '#7C3AED'];
function tileColor(name: string): string {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return TILE_COLORS[h % TILE_COLORS.length];
}

function BrandTile({ brand, size = 48 }: { brand: { name: string; logoUrl: string | null }; size?: number }) {
  if (brand.logoUrl) return <Image source={{ uri: brand.logoUrl }} style={{ width: size, height: size, borderRadius: 16 }} />;
  const initials = brand.name.replace(/[^A-Za-z ]/g, '').split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return (
    <View style={{ width: size, height: size, borderRadius: 16, backgroundColor: tileColor(brand.name), alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: '#fff', fontWeight: '800', fontSize: size * 0.36 }}>{initials || 'GC'}</Text>
    </View>
  );
}

function naira(minor: bigint): string {
  return `₦${(Number(minor) / 100).toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;
}

type Step = 'brand' | 'details' | 'card' | 'review' | 'done';

export default function GiftCardsScreen() {
  const insets = useSafeAreaInsets();
  const [brands, setBrands] = useState<GiftCardBrand[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [step, setStep] = useState<Step>('brand');
  const [brand, setBrand] = useState<GiftCardBrand | null>(null);
  const [country, setCountry] = useState('');
  const [cardType, setCardType] = useState<'PHYSICAL' | 'ECODE' | ''>('');
  const [amount, setAmount] = useState('');
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const [photos, setPhotos] = useState<{ id: string; uri: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [trade, setTrade] = useState<GiftCardTrade | null>(null);
  const submitKey = useRef('');

  useEffect(() => {
    api
      .getGiftCardRates()
      .then(({ brands }) => setBrands(brands))
      .catch((e) => {
        setError(e instanceof ApiError ? e.message : "Couldn't load gift cards.");
        setBrands([]);
      });
  }, []);

  const countries = useMemo(() => {
    const seen = new Map<string, GiftCardRate>();
    for (const r of brand?.rates ?? []) if (!seen.has(r.country)) seen.set(r.country, r);
    return [...seen.values()];
  }, [brand]);
  const types = (brand?.rates ?? []).filter((r) => r.country === country);
  const rate = types.find((r) => r.cardType === cardType) ?? null;
  const face = Math.trunc(Number(amount) || 0);
  const inRange = !!rate && face >= rate.minValue && face <= rate.maxValue;
  const payout = rate && face > 0 ? BigInt(face) * BigInt(rate.rateMinor) : 0n;
  const sym = (rate?.symbol ?? types[0]?.symbol ?? '$').trim();

  function pickBrand(b: GiftCardBrand) {
    setBrand(b);
    const c = b.rates[0]?.country ?? '';
    setCountry(c);
    const t = b.rates.filter((r) => r.country === c);
    setCardType(t.length === 1 ? t[0].cardType : '');
    setAmount('');
    setStep('details');
  }

  async function addPhoto() {
    setFormError(null);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setFormError('Photo access is needed to add a picture of the card.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.5,
      base64: true,
    });
    const asset = result.canceled ? null : result.assets?.[0];
    if (!asset?.base64) return;
    setUploading(true);
    try {
      const { id } = await api.uploadGiftCardPhoto(asset.base64, 'image/jpeg');
      setPhotos((p) => [...p, { id, uri: asset.uri }]);
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : "Couldn't upload that photo.");
    } finally {
      setUploading(false);
    }
  }

  async function submit() {
    if (!rate) return;
    setSubmitting(true);
    setFormError(null);
    if (!submitKey.current) submitKey.current = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    try {
      const res = await api.submitGiftCardTrade(
        {
          rateId: rate.id,
          faceValue: face,
          fileIds: photos.map((p) => p.id),
          ...(code.trim() ? { code: code.trim() } : {}),
          ...(pin.trim() ? { pin: pin.trim() } : {}),
        },
        submitKey.current,
      );
      setTrade(res.trade);
      setStep('done');
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : "Couldn't submit your card.");
    } finally {
      setSubmitting(false);
    }
  }

  function reset() {
    setStep('brand');
    setBrand(null);
    setAmount('');
    setCode('');
    setPin('');
    setPhotos([]);
    setTrade(null);
    submitKey.current = '';
  }

  const back = () => {
    if (step === 'details') setStep('brand');
    else if (step === 'card') setStep('details');
    else if (step === 'review') setStep('card');
    else router.back();
  };

  const input = {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 16,
    paddingHorizontal: 16, paddingVertical: 14, color: colors.ink, fontSize: 15,
  } as const;
  const chip = (on: boolean) => ({ backgroundColor: on ? colors.brand : colors.card, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 11, marginRight: 8, marginBottom: 8 });
  const primary = (disabled: boolean) => ({ backgroundColor: colors.brand, borderRadius: 999, paddingVertical: 16, alignItems: 'center' as const, opacity: disabled ? 0.4 : 1, marginTop: 8 });
  const label = { color: colors.ink, fontWeight: '600' as const, marginBottom: 8, marginTop: 16 };

  const shown = (brands ?? []).filter((b) => b.name.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface, paddingTop: insets.top }}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <TouchableOpacity onPress={back} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="arrow-back" size={20} color={colors.ink} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push('/(app)/gift-card-trades' as never)} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 999, paddingHorizontal: 14, height: 44 }}>
            <Ionicons name="time-outline" size={16} color={colors.ink} />
            <Text style={{ color: colors.ink, fontWeight: '600', marginLeft: 6 }}>My trades</Text>
          </TouchableOpacity>
        </View>

        <Text style={{ color: colors.ink, fontSize: 28, fontWeight: '800', marginTop: 12 }}>
          {step === 'brand' ? 'Sell gift cards' : step === 'done' ? 'Card submitted' : brand?.name}
        </Text>
        <Text style={{ color: colors.muted, marginTop: 4, marginBottom: 12 }}>
          {step === 'brand' ? 'Trade your gift cards for Naira, paid into your balance.' : step === 'details' ? 'Where is the card from, and how much is it worth?' : step === 'card' ? 'Add clear photos of the card, or type its code.' : step === 'review' ? 'Check everything before you submit.' : "We're checking your card now."}
        </Text>

        {step === 'brand' && (
          brands === null ? <ActivityIndicator color={colors.muted} style={{ marginTop: 60 }} />
          : error ? <Card><Text style={{ color: colors.muted, textAlign: 'center', paddingVertical: 20 }}>{error}</Text></Card>
          : brands.length === 0 ? <Card><Text style={{ color: colors.muted, textAlign: 'center', paddingVertical: 20 }}>We aren&apos;t buying gift cards right now. Check back soon.</Text></Card>
          : (
            <>
              <TextInput placeholder="Search cards" placeholderTextColor={colors.muted} value={query} onChangeText={setQuery} style={{ ...input, marginBottom: 12 }} />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
                {shown.map((b) => {
                  const best = b.rates.reduce((m, r) => (BigInt(r.rateMinor) > BigInt(m.rateMinor) ? r : m), b.rates[0]);
                  return (
                    <TouchableOpacity key={b.id} onPress={() => pickBrand(b)} activeOpacity={0.8} style={{ width: '48%', backgroundColor: colors.card, borderRadius: 24, padding: 16, marginBottom: 12 }}>
                      <BrandTile brand={b} />
                      <Text style={{ color: colors.ink, fontWeight: '700', marginTop: 12 }}>{b.name}</Text>
                      <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>Up to {best.rateFormatted}/{best.symbol.trim()}1</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          )
        )}

        {step === 'details' && brand && (
          <>
            <Text style={label}>Card country</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {countries.map((c) => (
                <TouchableOpacity key={c.country} style={chip(country === c.country)} onPress={() => {
                  setCountry(c.country);
                  const t = brand.rates.filter((r) => r.country === c.country);
                  setCardType(t.length === 1 ? t[0].cardType : '');
                }}>
                  <Text style={{ color: country === c.country ? '#fff' : colors.ink, fontWeight: '600' }}>{c.countryName} ({c.currency})</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={label}>Card type</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {types.map((t) => (
                <TouchableOpacity key={t.id} style={{ ...chip(cardType === t.cardType), borderRadius: 16, paddingVertical: 14 }} onPress={() => setCardType(t.cardType)}>
                  <Text style={{ color: cardType === t.cardType ? '#fff' : colors.ink, fontWeight: '700' }}>{t.cardType === 'ECODE' ? 'E-code' : 'Physical card'}</Text>
                  <Text style={{ color: cardType === t.cardType ? 'rgba(255,255,255,0.8)' : colors.muted, fontSize: 12 }}>{t.rateFormatted} per {t.symbol.trim()}1</Text>
                </TouchableOpacity>
              ))}
            </View>
            {rate && (
              <>
                <Text style={label}>Card value ({rate.currency})</Text>
                <TextInput keyboardType="number-pad" placeholder={`${sym}${rate.minValue} – ${sym}${rate.maxValue}`} placeholderTextColor={colors.muted} value={amount} onChangeText={(t) => setAmount(t.replace(/[^\d]/g, '').slice(0, 6))} style={{ ...input, fontSize: 20, fontWeight: '700' }} />
                <Text style={{ color: face > 0 && !inRange ? '#EF4444' : colors.muted, fontSize: 12, marginTop: 6 }}>From {sym}{rate.minValue} to {sym}{rate.maxValue}</Text>
                <Card className="mt-4">
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ color: colors.muted }}>You&apos;ll get</Text>
                    <Text style={{ color: colors.ink, fontSize: 24, fontWeight: '800' }}>{inRange ? naira(payout) : '—'}</Text>
                  </View>
                  <Text style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>Rate locked when you submit.</Text>
                </Card>
              </>
            )}
            <TouchableOpacity disabled={!inRange} onPress={() => setStep('card')} style={primary(!inRange)}>
              <Text style={{ color: '#fff', fontWeight: '700' }}>Continue</Text>
            </TouchableOpacity>
          </>
        )}

        {step === 'card' && rate && (
          <>
            <Text style={label}>Photos of the card</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {photos.map((p) => (
                <View key={p.id} style={{ width: 96, height: 96, borderRadius: 16, overflow: 'hidden', marginRight: 8, marginBottom: 8 }}>
                  <Image source={{ uri: p.uri }} style={{ width: '100%', height: '100%' }} />
                  <TouchableOpacity onPress={() => setPhotos((ps) => ps.filter((x) => x.id !== p.id))} style={{ position: 'absolute', top: 4, right: 4, width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name="close" size={16} color="#fff" />
                  </TouchableOpacity>
                </View>
              ))}
              {photos.length < 6 && (
                <TouchableOpacity onPress={addPhoto} disabled={uploading} style={{ width: 96, height: 96, borderRadius: 16, borderWidth: 2, borderStyle: 'dashed', borderColor: colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card }}>
                  {uploading ? <ActivityIndicator color={colors.muted} /> : <Ionicons name="camera-outline" size={22} color={colors.muted} />}
                  <Text style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>{uploading ? 'Uploading' : 'Add photo'}</Text>
                </TouchableOpacity>
              )}
            </View>
            <Text style={{ color: colors.muted, fontSize: 12 }}>
              {rate.cardType === 'PHYSICAL' ? 'Show the front and the scratched-off back with the code visible, plus the receipt if you have it.' : 'A screenshot of the e-code works.'}
            </Text>
            <Text style={label}>Card code {photos.length ? '(optional)' : ''}</Text>
            <TextInput placeholder="e.g. AQ12-ZZ34-HJ56" placeholderTextColor={colors.muted} autoCapitalize="characters" autoCorrect={false} value={code} onChangeText={(t) => setCode(t.slice(0, 120))} style={input} />
            <Text style={label}>PIN (if the card has one)</Text>
            <TextInput placeholder="Optional" placeholderTextColor={colors.muted} autoCorrect={false} value={pin} onChangeText={(t) => setPin(t.slice(0, 60))} style={input} />
            {formError && <Text style={{ color: '#EF4444', marginTop: 12 }}>{formError}</Text>}
            <TouchableOpacity disabled={uploading || (!photos.length && !code.trim())} onPress={() => setStep('review')} style={{ ...primary(uploading || (!photos.length && !code.trim())), marginTop: 20 }}>
              <Text style={{ color: '#fff', fontWeight: '700' }}>Review</Text>
            </TouchableOpacity>
          </>
        )}

        {step === 'review' && rate && brand && (
          <>
            <Card>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
                <BrandTile brand={brand} size={44} />
                <View style={{ marginLeft: 12 }}>
                  <Text style={{ color: colors.ink, fontWeight: '700' }}>{brand.name}</Text>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>{rate.countryName} · {rate.cardType === 'ECODE' ? 'E-code' : 'Physical card'}</Text>
                </View>
              </View>
              {[
                ['Card value', `${sym}${face.toLocaleString('en-US')}`],
                ['Rate', `${rate.rateFormatted} per ${sym}1`],
                ['Photos', String(photos.length)],
                ['Code', code.trim() ? 'Added' : '—'],
              ].map(([k, v]) => (
                <View key={k} style={{ flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: 12 }}>
                  <Text style={{ color: colors.muted }}>{k}</Text>
                  <Text style={{ color: colors.ink, fontWeight: '600' }}>{v}</Text>
                </View>
              ))}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 14 }}>
                <Text style={{ color: colors.ink, fontWeight: '600' }}>You&apos;ll get</Text>
                <Text style={{ color: colors.ink, fontSize: 24, fontWeight: '800' }}>{naira(payout)}</Text>
              </View>
            </Card>
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: 12, lineHeight: 18 }}>
              Our team checks every card. Once it&apos;s approved, the money lands in your Naira balance. A used card, or one that doesn&apos;t match what you entered, won&apos;t be paid.
            </Text>
            {formError && <Text style={{ color: '#EF4444', marginTop: 12 }}>{formError}</Text>}
            <TouchableOpacity disabled={submitting} onPress={submit} style={{ ...primary(submitting), marginTop: 16 }}>
              {submitting ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '700' }}>Submit card</Text>}
            </TouchableOpacity>
          </>
        )}

        {step === 'done' && trade && (
          <>
            <Card>
              <View style={{ alignItems: 'center', paddingVertical: 20 }}>
                <Ionicons name="checkmark-circle" size={56} color="#16A34A" />
                <Text style={{ color: colors.ink, fontSize: 18, fontWeight: '800', marginTop: 10 }}>We&apos;re reviewing your card</Text>
                <Text style={{ color: colors.muted, marginTop: 4 }}>{trade.faceValueFormatted} {trade.brandName} → {trade.payoutFormatted}</Text>
                <Text style={{ color: colors.muted, fontSize: 12, marginTop: 10 }}>We&apos;ll notify you the moment it&apos;s approved.</Text>
              </View>
            </Card>
            <TouchableOpacity onPress={() => router.push('/(app)/gift-card-trades' as never)} style={{ ...primary(false), marginTop: 16 }}>
              <Text style={{ color: '#fff', fontWeight: '700' }}>Track it</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={reset} style={{ backgroundColor: colors.card, borderRadius: 999, paddingVertical: 16, alignItems: 'center', marginTop: 10 }}>
              <Text style={{ color: colors.ink, fontWeight: '700' }}>Sell another card</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </View>
  );
}
