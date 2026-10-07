import { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { colors, Card } from '@/components/brand';
import { useTransactionPin, PIN_CANCELLED } from '@/components/TransactionPinProvider';
import { useFeatures } from '@/lib/useFeatures';
import { api, ApiError, type AdOptions, type AdPlacement, type AdQuote, type AdTargeting, type AdVenueOption } from '@/services/api';

const CTAS = ['Learn more', 'Shop now', 'Order now', 'Visit us', 'Book now', 'Sign up', 'Call now', 'Get offer'];
const addDays = (day: string, n: number) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const pretty = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' });

function Chip({ on, label, onPress }: { on: boolean; label: string; onPress: () => void }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      className="rounded-full px-3.5 py-2 mr-2 mb-2"
      style={{ borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? 'rgba(107,91,149,0.22)' : 'transparent' }}
    >
      <Text className={`text-sm font-semibold ${on ? 'text-ink dark:text-ink-dark' : 'text-muted dark:text-muted-dark'}`}>{on ? '✓ ' : ''}{label}</Text>
    </TouchableOpacity>
  );
}

function Stepper({ value, min, max, onChange, suffix = '' }: { value: number; min: number; max: number; onChange: (n: number) => void; suffix?: string }) {
  return (
    <View className="flex-row items-center">
      <TouchableOpacity onPress={() => onChange(Math.max(min, value - 1))} className="h-10 w-10 rounded-full items-center justify-center" style={{ backgroundColor: colors.circle }}>
        <Ionicons name="remove" size={18} color={colors.ink} />
      </TouchableOpacity>
      <Text className="text-ink dark:text-ink-dark font-bold text-base mx-3" style={{ minWidth: 44, textAlign: 'center' }}>{value}{suffix}</Text>
      <TouchableOpacity onPress={() => onChange(Math.min(max, value + 1))} className="h-10 w-10 rounded-full items-center justify-center" style={{ backgroundColor: colors.circle }}>
        <Ionicons name="add" size={18} color={colors.ink} />
      </TouchableOpacity>
    </View>
  );
}

/** Build an ad, see the price and audience as you go, pay with your PIN; an admin reviews it before it runs. */
export default function AdvertiseScreen() {
  const insets = useSafeAreaInsets();
  const features = useFeatures();
  const { authorize } = useTransactionPin();
  const [opts, setOpts] = useState<AdOptions | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [businessName, setBusinessName] = useState('');
  const [category, setCategory] = useState('food');
  const [headline, setHeadline] = useState('');
  const [body, setBody] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [linkUrl, setLinkUrl] = useState('');
  const [cta, setCta] = useState(CTAS[0]);
  const [placements, setPlacements] = useState<AdPlacement[]>(['receipt']);
  const [venues, setVenues] = useState<string[]>([]);
  const [venueList, setVenueList] = useState<AdVenueOption[] | null>(null);
  const [myVenues, setMyVenues] = useState<{ id: string; name: string; city: string }[]>([]);
  const [nearbyVenueId, setNearbyVenueId] = useState<string | null>(null);
  const [infOn, setInfOn] = useState(false);
  const [infPay, setInfPay] = useState('5000');
  const [infPosts, setInfPosts] = useState(5);
  const [infBrief, setInfBrief] = useState('');
  const [startOffset, setStartOffset] = useState(0);
  const [days, setDays] = useState(7);
  const [t, setT] = useState<AdTargeting | null>(null);
  const [quote, setQuote] = useState<AdQuote | null>(null);
  const [quoteErr, setQuoteErr] = useState<string | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [paying, setPaying] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    api.getAdOptions().then((o) => { setOpts(o); setT(o.defaults); }).catch((e) => setLoadError(e instanceof ApiError ? e.message : "Couldn't load the ad builder."));
  }, []);

  useEffect(() => {
    if (!opts) return;
    api.getAdVenues(null).then((r) => { setVenueList(r.venues); setMyVenues(r.myVenues); }).catch(() => setVenueList([]));
  }, [opts]);

  const startDay = opts ? addDays(opts.today, startOffset) : '';
  const adultOnly = opts?.categories.find((c) => c.key === category)?.adultOnly ?? false;

  // Influencer posts, once filled in properly.
  const infPayMinor = Math.round(Number(infPay.replace(/[^\d]/g, '') || 0) * 100);
  const infValid = infOn && !!opts && infPayMinor >= Number(opts.influencer.minPayMinor) && infPosts >= 1 && infPosts <= opts.influencer.maxPosts && infBrief.trim().length >= 10;
  const influencer = useMemo(
    () => (infValid ? { payPerPostMinor: String(infPayMinor), posts: infPosts, brief: infBrief.trim() } : null),
    [infValid, infPayMinor, infPosts, infBrief],
  );

  useEffect(() => {
    if (!opts || !t || (!placements.length && !venues.length && !nearbyVenueId && !influencer)) { setQuote(null); return; }
    setQuoting(true);
    const id = setTimeout(() => {
      api.quoteAd({ placements, venues, nearbyVenueId, influencer, startDay, days, category, targeting: adultOnly && t.ageMin < 18 ? { ...t, ageMin: 18 } : t })
        .then((q) => { setQuote(q); setQuoteErr(null); })
        .catch((e) => { setQuote(null); setQuoteErr(e instanceof ApiError ? e.message : "Couldn't price this campaign."); })
        .finally(() => setQuoting(false));
    }, 450);
    return () => clearTimeout(id);
  }, [opts, t, startDay, days, placements, venues, nearbyVenueId, influencer, category, adultOnly]);

  async function pickImage() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return setFormError('Photo access is needed to add your ad image.');
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [19, 10], quality: 0.35, base64: true });
    const a = r.canceled ? null : r.assets?.[0];
    if (!a?.base64) return;
    if (a.base64.length > 680_000) return setFormError('That image is too large. Crop it smaller or pick another.');
    const type = a.mimeType === 'image/png' ? 'image/png' : 'image/jpeg';
    setImage(`data:${type};base64,${a.base64}`);
    setFormError(null);
  }

  const toggle = <K,>(list: K[], v: K) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const linkOk = !linkUrl || /^https:\/\/[^\s/]+\.[^\s]+/.test(linkUrl.trim());
  const ready = !!quote && quote.audienceOk && quote.soldOut.length === 0 && businessName.trim().length >= 2 && headline.trim().length >= 3 && !!image && linkOk && (!infOn || infValid);
  const missing = !image ? 'Add an image to continue' : headline.trim().length < 3 ? 'Add a headline to continue' : businessName.trim().length < 2 ? 'Add your business name to continue' : !linkOk ? 'Fix the link' : infOn && !infValid ? 'Finish the influencer posts (pay, number and what to post)' : '';

  async function pay() {
    if (!ready || !t || !quote) return;
    setPaying(true);
    setFormError(null);
    try {
      await authorize(
        (pin) => api.createAdCampaign({ businessName: businessName.trim(), headline: headline.trim(), body: body.trim(), image: image!, linkUrl: linkUrl.trim() || null, cta, category, placements, venues, nearbyVenueId, influencer, startDay, days, targeting: adultOnly && t.ageMin < 18 ? { ...t, ageMin: 18 } : t }, pin),
        { title: 'Pay for your ad', detail: `${quote.totalFormatted} for ${days} day${days === 1 ? '' : 's'}. Refunded in full if it isn't approved.` },
      );
      router.replace('/(app)/ad-campaigns?new=1' as never);
    } catch (e) {
      if (e instanceof Error && e.message === PIN_CANCELLED) return;
      setFormError(e instanceof ApiError ? e.message : "That didn't go through. Please try again.");
    } finally {
      setPaying(false);
    }
  }

  const input = 'rounded-2xl px-4 py-3.5 text-ink dark:text-ink-dark mb-3';
  const inputStyle = { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card };
  const label = (s: string) => <Text className="text-muted dark:text-muted-dark text-xs font-bold mb-3" style={{ letterSpacing: 2 }}>{s}</Text>;
  const endDay = useMemo(() => (startDay ? addDays(startDay, days - 1) : ''), [startDay, days]);

  return (
    <View className="flex-1" style={{ backgroundColor: colors.surface, paddingTop: insets.top + 8 }}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled">
        <View className="flex-row items-center justify-between">
          <TouchableOpacity onPress={() => router.back()} className="h-11 w-11 rounded-full items-center justify-center" style={{ backgroundColor: colors.card }}>
            <Ionicons name="arrow-back" size={20} color={colors.ink} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push('/(app)/ad-campaigns' as never)} className="rounded-full px-4 py-2.5" style={{ backgroundColor: colors.card }}>
            <Text className="text-ink dark:text-ink-dark font-bold text-sm">My campaigns</Text>
          </TouchableOpacity>
        </View>
        <Text className="text-ink dark:text-ink-dark text-2xl font-extrabold mt-4">Advertise on CheqPay</Text>
        <Text className="text-muted dark:text-muted-dark text-sm mt-1 mb-4">Reach people where they pay. Every ad is reviewed before it runs.</Text>

        {!features.ads ? (
          <Card><Text className="text-muted dark:text-muted-dark text-center py-6">Advertising is coming soon.</Text></Card>
        ) : !opts || !t ? (
          loadError ? <Card><Text className="text-muted dark:text-muted-dark text-center py-6">{loadError}</Text></Card> : <ActivityIndicator style={{ marginTop: 60 }} color={colors.brand} />
        ) : !opts.canAdvertise ? (
          <Card>
            <Text className="text-ink dark:text-ink-dark font-bold text-center">Verify your identity to advertise</Text>
            <Text className="text-muted dark:text-muted-dark text-sm text-center mt-1">We only run ads from verified people and businesses.</Text>
            <TouchableOpacity onPress={() => router.push('/(app)/kyc')} className="rounded-full py-3 mt-4 items-center" style={{ backgroundColor: colors.brand }}>
              <Text className="text-white font-bold">Verify now</Text>
            </TouchableOpacity>
          </Card>
        ) : (
          <>
            <Card className="mb-4">
              {label('1 · YOUR AD')}
              <TextInput value={businessName} onChangeText={(v) => setBusinessName(v.slice(0, 60))} placeholder="Business name" placeholderTextColor={colors.muted} className={input} style={inputStyle} />
              <View className="flex-row flex-wrap">
                {opts.categories.map((c) => <Chip key={c.key} on={category === c.key} label={c.label} onPress={() => setCategory(c.key)} />)}
              </View>
              <TextInput value={headline} onChangeText={(v) => setHeadline(v.slice(0, 40))} placeholder="Headline (40 characters)" placeholderTextColor={colors.muted} className={`${input} mt-2`} style={inputStyle} />
              <TextInput value={body} onChangeText={(v) => setBody(v.slice(0, 120))} placeholder="One line about the offer (optional)" placeholderTextColor={colors.muted} multiline className={input} style={inputStyle} />
              <TouchableOpacity onPress={pickImage} className="rounded-2xl py-5 items-center mb-3" style={{ borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border }}>
                <Text className="text-muted dark:text-muted-dark font-semibold">{image ? 'Change image' : '＋ Add an image (landscape)'}</Text>
              </TouchableOpacity>
              <TextInput value={linkUrl} onChangeText={setLinkUrl} placeholder="Link (optional) — https://…" placeholderTextColor={colors.muted} autoCapitalize="none" keyboardType="url" className={input} style={{ ...inputStyle, borderColor: linkOk ? colors.border : '#EF4444' }} />
              <View className="flex-row flex-wrap">
                {CTAS.map((c) => <Chip key={c} on={cta === c} label={c} onPress={() => setCta(c)} />)}
              </View>
            </Card>

            {/* Preview */}
            <View className="bg-card dark:bg-card-dark rounded-3xl p-4 mb-4">
              <Text className="text-muted dark:text-muted-dark text-[11px] font-semibold mb-2">Sponsored · <Text className="text-ink dark:text-ink-dark">{businessName || 'Your business'}</Text></Text>
              {image ? <Image alt="" source={{ uri: image }} style={{ width: '100%', aspectRatio: 1.91, borderRadius: 16 }} /> : <View style={{ width: '100%', aspectRatio: 1.91, borderRadius: 16, backgroundColor: colors.circle }} />}
              <Text className="text-ink dark:text-ink-dark font-bold mt-3">{headline || 'Your headline'}</Text>
              {body ? <Text className="text-muted dark:text-muted-dark text-sm">{body}</Text> : null}
            </View>

            <Card className="mb-4">
              {label('2 · WHERE IT SHOWS')}
              {opts.placements.map((p) => {
                const on = placements.includes(p.key);
                const full = quote?.soldOut.filter((s) => s.channel === `placement:${p.key}`).length ?? 0;
                return (
                  <TouchableOpacity key={p.key} onPress={() => setPlacements(toggle(placements, p.key))} className="flex-row items-center rounded-2xl p-4 mb-2" style={{ borderWidth: 1, borderColor: on ? colors.brand : colors.border }}>
                    <Ionicons name={on ? 'checkbox' : 'square-outline'} size={22} color={on ? colors.brand : colors.muted} />
                    <View className="ml-3 flex-1">
                      <Text className="text-ink dark:text-ink-dark font-bold">{p.label}</Text>
                      <Text className="text-muted dark:text-muted-dark text-xs">{p.perDayFormatted} a day{on && full ? ` · fully booked on ${full} of your days` : ''}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}

              <Text className="text-ink dark:text-ink-dark font-bold mt-4">📺 Screens at partner venues</Text>
              <Text className="text-muted dark:text-muted-dark text-xs mt-1 mb-2">Plays on TVs in gyms, restaurants and stores. You only pay for days the screen was on for {opts.minScreenHours}+ hours.</Text>
              {venueList === null ? (
                <ActivityIndicator color={colors.brand} />
              ) : venueList.length === 0 ? (
                <Text className="text-muted dark:text-muted-dark text-sm">No partner screens yet.</Text>
              ) : (
                venueList.map((v) => {
                  const on = venues.includes(v.id);
                  return (
                    <TouchableOpacity key={v.id} onPress={() => setVenues(toggle(venues, v.id))} className="flex-row items-center rounded-2xl p-3 mb-2" style={{ borderWidth: 1, borderColor: on ? colors.brand : colors.border }}>
                      <Ionicons name={on ? 'checkbox' : 'square-outline'} size={22} color={on ? colors.brand : colors.muted} />
                      <View className="ml-3 flex-1">
                        <Text className="text-ink dark:text-ink-dark font-bold" numberOfLines={1}>{v.name}</Text>
                        <Text className="text-muted dark:text-muted-dark text-xs">{v.categoryLabel} · {v.city || v.state} · {v.perDayFormatted} a day{v.online ? ' · ● on now' : ''}</Text>
                      </View>
                    </TouchableOpacity>
                  );
                })
              )}

              {myVenues.length > 0 ? (
                <>
                  <Text className="text-ink dark:text-ink-dark font-bold mt-4">📍 Feature my venue in Nearby</Text>
                  <Text className="text-muted dark:text-muted-dark text-xs mt-1 mb-2">Pinned at the top of &quot;Places near you&quot; for people nearby. {opts.nearby.perDayFormatted} a day.</Text>
                  <View className="flex-row flex-wrap">
                    <Chip on={!nearbyVenueId} label="Don't feature" onPress={() => setNearbyVenueId(null)} />
                    {myVenues.map((v) => <Chip key={v.id} on={nearbyVenueId === v.id} label={v.name} onPress={() => setNearbyVenueId(v.id)} />)}
                  </View>
                </>
              ) : null}

              <TouchableOpacity onPress={() => setInfOn(!infOn)} className="flex-row items-center mt-4 pt-4" style={{ borderTopWidth: 1, borderColor: colors.border }}>
                <View className="flex-1 pr-3">
                  <Text className="text-ink dark:text-ink-dark font-bold">✨ Influencer posts</Text>
                  <Text className="text-muted dark:text-muted-dark text-xs mt-0.5">CheqPay creators post about you on their socials. You only pay for posts we approve — unused posts are refunded.</Text>
                </View>
                <View className="rounded-full p-0.5" style={{ width: 44, height: 24, backgroundColor: infOn ? colors.brand : colors.border, alignItems: infOn ? 'flex-end' : 'flex-start' }}>
                  <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff' }} />
                </View>
              </TouchableOpacity>
              {infOn ? (
                <View className="mt-3">
                  <View className="flex-row" style={{ gap: 12 }}>
                    <View className="flex-1">
                      <Text className="text-muted dark:text-muted-dark text-xs font-semibold mb-1">Pay per post (₦)</Text>
                      <TextInput value={infPay} onChangeText={(v) => setInfPay(v.replace(/[^\d]/g, ''))} keyboardType="number-pad" className={input} style={inputStyle} />
                    </View>
                    <View className="flex-1">
                      <Text className="text-muted dark:text-muted-dark text-xs font-semibold mb-1">Number of posts</Text>
                      <TextInput value={infPosts ? String(infPosts) : ''} onChangeText={(v) => setInfPosts(Math.min(opts.influencer.maxPosts, Number(v.replace(/[^\d]/g, '') || 0)))} keyboardType="number-pad" className={input} style={inputStyle} />
                    </View>
                  </View>
                  {infPayMinor > 0 && infPayMinor < Number(opts.influencer.minPayMinor) ? <Text className="text-xs mb-2" style={{ color: '#FBBF24' }}>Pay at least {opts.influencer.minPayFormatted} a post.</Text> : null}
                  <TextInput value={infBrief} onChangeText={(v) => setInfBrief(v.slice(0, 1000))} placeholder="What should they post? e.g. Show our jollof in a short video and mention 20% off" placeholderTextColor={colors.muted} multiline className={input} style={[inputStyle, { minHeight: 80, textAlignVertical: 'top' }]} />
                  <Text className="text-muted dark:text-muted-dark text-xs">Creators see your brief and ad image. Each approved post pays the creator your amount; CheqPay adds {opts.influencer.feePercent}% on top.</Text>
                </View>
              ) : null}
            </Card>

            <Card className="mb-4">
              {label('3 · WHEN')}
              <View className="flex-row items-center justify-between mb-3">
                <Text className="text-ink dark:text-ink-dark font-semibold">Starts {startOffset === 0 ? 'today' : startOffset === 1 ? 'tomorrow' : pretty(startDay)}</Text>
                <Stepper value={startOffset} min={0} max={90} onChange={setStartOffset} suffix="d" />
              </View>
              <View className="flex-row items-center justify-between">
                <Text className="text-ink dark:text-ink-dark font-semibold">Runs for</Text>
                <Stepper value={days} min={1} max={opts.maxDays} onChange={setDays} suffix="d" />
              </View>
              <Text className="text-muted dark:text-muted-dark text-sm mt-3">{pretty(startDay)} → {pretty(endDay)}</Text>
            </Card>

            <Card className="mb-4">
              {label('4 · WHO SEES IT')}
              <Text className="text-ink dark:text-ink-dark font-bold mb-2">Location</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-3">
                <Chip on={t.states.length === 0} label="Anywhere" onPress={() => setT({ ...t, states: [], radius: null })} />
                {opts.states.map((s) => <Chip key={s} on={t.states.includes(s)} label={s} onPress={() => setT({ ...t, states: toggle(t.states, s) })} />)}
              </ScrollView>
              <View className="flex-row items-center justify-between mb-2">
                <Text className="text-ink dark:text-ink-dark font-bold">Youngest</Text>
                <Stepper value={t.ageMin} min={adultOnly ? 18 : 13} max={t.ageMax} onChange={(n) => setT({ ...t, ageMin: n })} />
              </View>
              <View className="flex-row items-center justify-between mb-3">
                <Text className="text-ink dark:text-ink-dark font-bold">Oldest</Text>
                <Stepper value={t.ageMax} min={t.ageMin} max={100} onChange={(n) => setT({ ...t, ageMax: n })} />
              </View>
              <Text className="text-ink dark:text-ink-dark font-bold mb-2">Interests</Text>
              <View className="flex-row flex-wrap mb-2">
                {opts.segments.map((s) => <Chip key={s.key} on={t.segments.includes(s.key)} label={s.label} onPress={() => setT({ ...t, segments: toggle(t.segments, s.key) })} />)}
              </View>
              <Text className="text-ink dark:text-ink-dark font-bold mb-2">Time of day</Text>
              <View className="flex-row flex-wrap mb-2">
                <Chip on={t.dayparts.length === 0} label="All day" onPress={() => setT({ ...t, dayparts: [] })} />
                {opts.dayparts.map((d) => <Chip key={d.key} on={t.dayparts.includes(d.key)} label={d.label} onPress={() => setT({ ...t, dayparts: toggle(t.dayparts, d.key) })} />)}
              </View>
              <View className="flex-row flex-wrap mb-2">
                <Chip on={t.newUsersOnly} label="Only new CheqPay users" onPress={() => setT({ ...t, newUsersOnly: !t.newUsersOnly })} />
              </View>
              <View className="flex-row items-center justify-between">
                <Text className="text-ink dark:text-ink-dark font-bold">Times a day per person</Text>
                <Stepper value={t.frequencyCap} min={1} max={opts.maxFrequencyCap} onChange={(n) => setT({ ...t, frequencyCap: n })} />
              </View>
            </Card>

            <Card className="mb-4">
              <Text className="text-ink dark:text-ink-dark text-lg font-extrabold">{quote ? (quote.audience === null ? (venues.length || nearbyVenueId ? 'People at the venues' : "Creators' followers") : `≈ ${quote.audience.toLocaleString('en-NG')} people`) : '—'} {quoting ? '…' : ''}</Text>
              <Text className="text-muted dark:text-muted-dark text-xs">{quote?.audience === null ? 'Screens and Nearby reach whoever is there' : 'match your targeting in the app today'}</Text>
              {quote && !quote.audienceOk ? <Text className="text-xs mt-2" style={{ color: '#F59E0B' }}>Fewer than {quote.minAudience} people — widen your targeting.</Text> : null}
              {quoteErr ? <Text className="text-xs mt-2" style={{ color: '#F87171' }}>{quoteErr}</Text> : null}
              {quote ? (
                <View className="mt-3 pt-3" style={{ borderTopWidth: 1, borderColor: colors.border }}>
                  {quote.lines.map((l) => (
                    <View key={l.channel} className="flex-row justify-between mb-1">
                      <Text className="text-muted dark:text-muted-dark text-sm">{l.label} × {l.days}{l.unit === 'post' ? ` post${l.days === 1 ? '' : 's'}` : 'd'}</Text>
                      <Text className="text-ink dark:text-ink-dark text-sm font-semibold">{l.totalFormatted}</Text>
                    </View>
                  ))}
                  <View className="flex-row justify-between mt-2">
                    <Text className="text-ink dark:text-ink-dark font-bold">Total</Text>
                    <Text className="text-ink dark:text-ink-dark font-extrabold">{quote.totalFormatted}</Text>
                  </View>
                  {quote.soldOut.length ? <Text className="text-xs mt-2" style={{ color: '#F87171' }}>Some days are fully booked — change the dates or untick that place.</Text> : null}
                </View>
              ) : null}
              <Text className="text-muted dark:text-muted-dark text-xs mt-3">Paid from your Naira balance. Not approved = every naira back. Stop any time for a refund of the days left.</Text>
            </Card>

            {formError ? <Text className="text-sm mb-3 text-center" style={{ color: '#F87171' }}>{formError}</Text> : null}
            <TouchableOpacity onPress={pay} disabled={!ready || paying || quoting} className="rounded-full py-4 items-center" style={{ backgroundColor: colors.brand, opacity: !ready || paying || quoting ? 0.4 : 1 }}>
              {paying ? <ActivityIndicator color="#fff" /> : <Text className="text-white font-bold text-base">{quote ? `Pay ${quote.totalFormatted} & send for review` : 'Pay & send for review'}</Text>}
            </TouchableOpacity>
            {!ready && quote && missing ? <Text className="text-muted dark:text-muted-dark text-xs text-center mt-2">{missing}</Text> : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}
