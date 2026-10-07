import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Modal, TextInput, ActivityIndicator, Pressable, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useAuthStore } from '@/store';
import { colors, TopBar } from '@/components/brand';
import { useFeatures } from '@/lib/useFeatures';
import SponsoredCard from '@/components/SponsoredCard';
import { useTransactionPin, PIN_CANCELLED } from '@/components/TransactionPinProvider';
import { api, ApiError, type BillSuggestion, type BillsOverview, type SavedBill } from '@/services/api';
import { BILL_SECTIONS, maskCustomer, tileFor } from '@/lib/billServices';

const PURPLE = '#6D28D9';
const GREEN = '#4ADE80';
const AMBER = '#FBBF24';
const trimKobo = (s: string) => s.replace(/\.00(?=\b|,|$)/g, '');
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;

const NAME_IDEAS: Record<string, string[]> = {
  airtime: ["My line", "Mum's line", "Dad's line"],
  data: ['My data', 'Home router', 'Work phone'],
  electricity: ['Home meter', 'Shop meter'],
  cabletv: ['Living room TV', 'Bedroom TV'],
  betting: ['My wallet'],
};

/** Route + params that open a saved bill's service flow, prefilled. */
function payTarget(b: { service: string; billerId: string; customer: string; planId: string | null; expectedMinor: string | null }, withAmount = true) {
  const params: Record<string, string> = { biller: b.billerId, customer: b.customer };
  if (b.planId) params.plan = b.planId;
  else if (withAmount && b.expectedMinor) params.amount = String(Number(b.expectedMinor) / 100);
  return { pathname: `/(app)/bill/${b.service}`, params } as never;
}

type Sheet = { kind: 'save'; s: BillSuggestion } | { kind: 'manage'; b: SavedBill } | { kind: 'autopay'; b: SavedBill } | { kind: 'month' };

/**
 * Pay bills: what you've paid this month (and the cashback it earned), the
 * bills still to sort — renew, top up, or let autopay handle them — then
 * everything else you can pay, and the sponsored slot last.
 */
export default function PayBillScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const features = useFeatures();
  const { authorize } = useTransactionPin();
  const [month, setMonth] = useState<string | undefined>();
  const [data, setData] = useState<BillsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    (m?: string) =>
      api
        .getBillsOverview(m)
        .then((d) => { setData(d); setError(null); })
        .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load your bills.")),
    [],
  );
  useEffect(() => { void load(month); }, [load, month]);

  const others = useMemo(() => BILL_SECTIONS.flatMap((s) => s.tiles).filter((t) => !t.flag || features[t.flag]), [features]);
  const paid = Number(data?.paidMinor ?? 0);
  const left = Number(data?.stillToSortMinor ?? 0);
  const pct = paid + left > 0 ? Math.max(paid > 0 ? 4 : 0, Math.round((paid / (paid + left)) * 100)) : 0;
  const unpaid = data?.bills.filter((b) => b.state !== 'paid') ?? [];
  const sorted = data?.bills.filter((b) => b.state === 'paid') ?? [];

  async function run(fn: () => Promise<unknown>, done?: string) {
    setBusy(true);
    try {
      await fn();
      setSheet(null);
      await load(month);
      if (done) Alert.alert(done);
    } catch (e) {
      if (e instanceof Error && e.message === PIN_CANCELLED) return;
      Alert.alert(e instanceof ApiError ? e.message : "That didn't save. Try again.");
    } finally {
      setBusy(false);
    }
  }
  function autopayOn(b: SavedBill, day: number, amount?: string) {
    const patch = { autopay: true, autopayDay: day, ...(b.planId ? {} : { amount: amount ?? null }) };
    const money = b.planId ? (b.expectedFormatted ? trimKobo(b.expectedFormatted) : b.planName) : `₦${Number(amount ?? 0).toLocaleString('en-NG')}`;
    return run(
      () =>
        authorize((pin) => api.updateSavedBill(b.id, patch, pin), {
          title: 'Turn on autopay',
          detail: `${money} to ${b.billerName} ${maskCustomer(b.customer)} on the ${ordinal(day)} of every month, from your Naira balance.`,
        }),
      `Autopay on for ${b.nickname}`,
    );
  }
  const autopayOff = (b: SavedBill) => run(() => api.updateSavedBill(b.id, { autopay: false }));

  return (
    <View className="flex-1" style={{ backgroundColor: colors.surface, paddingTop: insets.top }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
        <TopBar name={user?.full_name} onAvatarPress={() => router.push('/(app)/profile')} icons={[{ name: 'search-outline' }, { name: 'notifications-outline' }]} />

        <View className="flex-row items-center justify-between px-5 mt-2 mb-4">
          <Text className="text-ink dark:text-ink-dark font-extrabold" style={{ fontSize: 32 }}>Pay bills</Text>
          <TouchableOpacity onPress={() => data && setSheet({ kind: 'month' })} className="flex-row items-center rounded-full px-4 py-2.5 bg-card dark:bg-card-dark">
            <Text className="text-ink dark:text-ink-dark font-semibold text-sm">{data?.monthLabel ?? 'This month'}</Text>
            <Ionicons name="chevron-down" size={16} color={colors.muted} style={{ marginLeft: 6 }} />
          </TouchableOpacity>
        </View>

        {/* Month summary */}
        <View className="px-5 mb-6">
          <View className="bg-card dark:bg-card-dark rounded-3xl p-5">
            <View className="flex-row items-start justify-between">
              <Text className="text-muted dark:text-muted-dark text-sm">{data ? (data.isCurrentMonth ? `Paid so far in ${data.monthLabel}` : `Paid in ${data.monthLabel}`) : 'Paid this month'}</Text>
              {data && Number(data.cashbackMinor) > 0 ? (
                <View className="rounded-full px-3 py-1" style={{ backgroundColor: 'rgba(34,197,94,0.16)' }}>
                  <Text style={{ color: GREEN, fontWeight: '700', fontSize: 12 }}>+{trimKobo(data.cashbackFormatted)} cashback</Text>
                </View>
              ) : null}
            </View>
            <Text className="text-ink dark:text-ink-dark font-extrabold mt-1" style={{ fontSize: 40, letterSpacing: -1 }}>{data ? trimKobo(data.paidFormatted) : '—'}</Text>
            <View className="mt-4 rounded-full overflow-hidden flex-row" style={{ height: 12, backgroundColor: 'rgba(150,140,180,0.22)' }}>
              <View style={{ width: `${pct}%`, flexDirection: 'row', borderRadius: 99, overflow: 'hidden' }}>
                <View style={{ flex: 1, backgroundColor: '#7C3AED' }} />
                <View style={{ flex: 1, backgroundColor: '#D946EF' }} />
                <View style={{ flex: 1, backgroundColor: '#FB923C' }} />
              </View>
            </View>
            <View className="flex-row items-center justify-between mt-3">
              <View className="flex-row items-center">
                <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: '#C026D3' }} />
                <Text className="text-muted dark:text-muted-dark text-xs ml-1.5">Paid</Text>
              </View>
              {left > 0 ? (
                <View className="flex-row items-center">
                  <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: 'rgba(150,140,180,0.45)' }} />
                  <Text className="text-muted dark:text-muted-dark text-xs ml-1.5">Still to sort {data ? trimKobo(data.stillToSortFormatted) : ''}</Text>
                </View>
              ) : data && data.bills.length > 0 ? (
                <Text style={{ color: GREEN, fontSize: 12, fontWeight: '600' }}>✓ All sorted</Text>
              ) : null}
            </View>
          </View>
        </View>

        {error ? <Text className="mx-5 mb-4 text-sm" style={{ color: '#F87171' }}>{error}</Text> : null}
        {!data && !error ? <ActivityIndicator color={colors.brand} style={{ marginVertical: 30 }} /> : null}

        {/* Still to sort */}
        {data && (unpaid.length > 0 || data.bills.length === 0) ? (
          <View className="px-5 mb-6">
            <Text className="text-ink dark:text-ink-dark font-bold text-lg mb-3">{data.isCurrentMonth ? 'Still to sort' : 'Not paid that month'}</Text>
            {unpaid.length > 0 ? (
              <View className="bg-card dark:bg-card-dark rounded-3xl overflow-hidden">
                {unpaid.map((b, i) => (
                  <BillRow key={b.id} b={b} first={i === 0} onOpen={() => setSheet({ kind: 'manage', b })}>
                    {b.state === 'due' ? (
                      <Pill label="Renew" primary onPress={() => router.push(payTarget(b))} />
                    ) : b.state === 'topup' ? (
                      <Pill label="Top up" onPress={() => router.push(payTarget(b, false))} />
                    ) : b.canAutopay && (b.service === 'airtime' || b.service === 'data' || b.autopay) ? (
                      <Toggle on={b.autopay} disabled={busy} onChange={(on) => (on ? setSheet({ kind: 'autopay', b }) : void autopayOff(b))} />
                    ) : (
                      <Pill label="Pay" onPress={() => router.push(payTarget(b))} />
                    )}
                  </BillRow>
                ))}
              </View>
            ) : (
              <View className="bg-card dark:bg-card-dark rounded-3xl p-5">
                <Text className="text-ink dark:text-ink-dark font-semibold">Keep your regular bills here</Text>
                <Text className="text-muted dark:text-muted-dark text-sm mt-1">
                  After you pay a bill, save it with a name like &ldquo;Mum&apos;s line&rdquo; or &ldquo;Home meter&rdquo;. We&apos;ll show when it&apos;s due, and you can switch on autopay.
                </Text>
              </View>
            )}
          </View>
        ) : null}

        {/* Suggestions */}
        {data && data.isCurrentMonth && data.suggestions.length > 0 ? (
          <View className="px-5 mb-6">
            <Text className="text-ink dark:text-ink-dark font-bold text-base mb-3">✨ You pay these often</Text>
            <View className="bg-card dark:bg-card-dark rounded-3xl overflow-hidden">
              {data.suggestions.map((s, i) => {
                const t = tileFor(s.service);
                return (
                  <View key={`${s.service}|${s.customer}`} className="flex-row items-center p-4" style={i ? { borderTopWidth: 1, borderColor: colors.border } : undefined}>
                    <View className="w-11 h-11 rounded-2xl items-center justify-center mr-3" style={{ backgroundColor: colors.circle }}>
                      {t ? <Ionicons name={t.icon} size={20} color={colors.ink} /> : null}
                    </View>
                    <View className="flex-1">
                      <Text numberOfLines={1} className="text-ink dark:text-ink-dark font-bold">{s.billerName} {s.serviceLabel.toLowerCase()}</Text>
                      <Text numberOfLines={1} className="text-muted dark:text-muted-dark text-sm">{maskCustomer(s.customer)} · {trimKobo(s.amountFormatted)} · paid {s.times}×</Text>
                    </View>
                    <Pill label="Save" onPress={() => setSheet({ kind: 'save', s })} />
                  </View>
                );
              })}
            </View>
          </View>
        ) : null}

        {/* Sorted */}
        {sorted.length > 0 ? (
          <View className="px-5 mb-6">
            <Text className="text-ink dark:text-ink-dark font-bold text-base mb-3">{data?.isCurrentMonth ? 'Sorted this month' : `Paid in ${data?.monthLabel}`}</Text>
            <View className="bg-card dark:bg-card-dark rounded-3xl overflow-hidden">
              {sorted.map((b, i) => (
                <BillRow key={b.id} b={b} first={i === 0} onOpen={() => setSheet({ kind: 'manage', b })}>
                  <Text style={{ color: GREEN, fontWeight: '700' }}>✓ Paid</Text>
                </BillRow>
              ))}
            </View>
          </View>
        ) : null}

        {/* Pay something else */}
        <Text className="text-ink dark:text-ink-dark font-bold text-lg mb-3 px-5">Pay something else</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20 }} style={{ marginBottom: 24 }}>
          {others.map((t) => (
            <TouchableOpacity key={t.key} disabled={!t.route} onPress={() => t.route && router.push(t.route as never)} className="items-center mr-4" style={{ width: 72, opacity: t.route ? 1 : 0.5 }}>
              <View className="w-14 h-14 rounded-2xl items-center justify-center bg-card dark:bg-card-dark">
                <Ionicons name={t.icon} size={24} color={colors.ink} />
              </View>
              <Text numberOfLines={2} className="text-ink dark:text-ink-dark font-semibold text-center mt-2" style={{ fontSize: 12 }}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <View className="px-5 mb-5">
          <SponsoredCard placement="paybills" />
        </View>
      </ScrollView>

      <Modal visible={!!sheet} transparent animationType="slide" onRequestClose={() => !busy && setSheet(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }} onPress={() => !busy && setSheet(null)}>
          <Pressable className="bg-card dark:bg-card-dark rounded-t-3xl p-5" style={{ paddingBottom: insets.bottom + 24 }} onPress={() => undefined}>
            {sheet?.kind === 'month' && data ? (
              <View>
                <Text className="text-ink dark:text-ink-dark font-extrabold text-lg mb-3">Show month</Text>
                {data.months.map((m) => (
                  <TouchableOpacity key={m.key} onPress={() => { setSheet(null); setData(null); setMonth(m.key); }} className="py-3 flex-row justify-between">
                    <Text className="text-ink dark:text-ink-dark text-base">{m.label}</Text>
                    {m.key === data.month ? <Ionicons name="checkmark" size={20} color={colors.brand} /> : null}
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}
            {sheet?.kind === 'save' ? (
              <SaveSheet
                s={sheet.s}
                busy={busy}
                onSave={(nickname) =>
                  run(
                    () => api.saveBill({ service: sheet.s.service, billerId: sheet.s.billerId, customer: sheet.s.customer, nickname, planId: sheet.s.planId, amount: String(Number(sheet.s.amountMinor) / 100) }),
                    `Saved as ${nickname}`,
                  )
                }
              />
            ) : null}
            {sheet?.kind === 'autopay' ? <AutopaySheet b={sheet.b} busy={busy} onConfirm={(day, amount) => autopayOn(sheet.b, day, amount)} /> : null}
            {sheet?.kind === 'manage' ? (
              <ManageSheet
                b={sheet.b}
                busy={busy}
                onPay={() => { const t = payTarget(sheet.b); setSheet(null); router.push(t); }}
                onRename={(nickname) => run(() => api.updateSavedBill(sheet.b.id, { nickname }))}
                onAutopay={(on) => (on ? setSheet({ kind: 'autopay', b: sheet.b }) : void autopayOff(sheet.b))}
                onDelete={() => run(() => api.deleteSavedBill(sheet.b.id))}
              />
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function BillRow({ b, first, onOpen, children }: { b: SavedBill; first: boolean; onOpen: () => void; children: React.ReactNode }) {
  const t = tileFor(b.service);
  return (
    <View className="flex-row items-center p-4" style={first ? undefined : { borderTopWidth: 1, borderColor: colors.border }}>
      <TouchableOpacity onPress={onOpen} activeOpacity={0.7} className="flex-row items-center flex-1 mr-3">
        <View className="w-11 h-11 rounded-2xl items-center justify-center mr-3" style={{ backgroundColor: colors.circle }}>
          {t ? <Ionicons name={t.icon} size={20} color={colors.ink} /> : null}
        </View>
        <View className="flex-1">
          <Text numberOfLines={1} className="text-ink dark:text-ink-dark font-bold">{b.nickname}</Text>
          <Text className="text-sm" style={{ color: b.autopayNote ? AMBER : colors.muted, lineHeight: 19 }}>{trimKobo(b.detail)}</Text>
        </View>
      </TouchableOpacity>
      {children}
    </View>
  );
}

function Pill({ label, onPress, primary }: { label: string; onPress: () => void; primary?: boolean }) {
  return (
    <TouchableOpacity onPress={onPress} className="rounded-full px-5 py-2.5" style={{ backgroundColor: primary ? PURPLE : colors.circle }}>
      <Text style={{ color: primary ? '#fff' : colors.ink, fontWeight: '700', fontSize: 14 }}>{label}</Text>
    </TouchableOpacity>
  );
}

function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (on: boolean) => void; disabled?: boolean }) {
  return (
    <TouchableOpacity
      accessibilityRole="switch"
      accessibilityState={{ checked: on, disabled }}
      disabled={disabled}
      onPress={() => onChange(!on)}
      style={{ width: 56, height: 32, borderRadius: 16, padding: 4, backgroundColor: on ? PURPLE : 'rgba(255,255,255,0.2)', alignItems: on ? 'flex-end' : 'flex-start', opacity: disabled ? 0.5 : 1 }}
    >
      <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: '#fff' }} />
    </TouchableOpacity>
  );
}

const inputStyle = { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, color: colors.ink, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16 };

function Ideas({ list, onPick }: { list: string[]; onPick: (s: string) => void }) {
  return (
    <View className="flex-row flex-wrap mt-2">
      {list.map((n) => (
        <TouchableOpacity key={n} onPress={() => onPick(n)} className="rounded-full px-3 py-1.5 mr-2 mb-2" style={{ backgroundColor: colors.circle }}>
          <Text className="text-ink dark:text-ink-dark text-xs font-semibold">{n}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function BigButton({ label, onPress, disabled, color = colors.brand }: { label: string; onPress: () => void; disabled?: boolean; color?: string }) {
  return (
    <TouchableOpacity disabled={disabled} onPress={onPress} className="rounded-full py-3.5 items-center mt-4" style={{ backgroundColor: color, opacity: disabled ? 0.4 : 1 }}>
      <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>{label}</Text>
    </TouchableOpacity>
  );
}

function SaveSheet({ s, busy, onSave }: { s: BillSuggestion; busy: boolean; onSave: (name: string) => void }) {
  const [name, setName] = useState('');
  return (
    <View>
      <Text className="text-ink dark:text-ink-dark font-extrabold text-lg">Save this bill</Text>
      <Text className="text-muted dark:text-muted-dark text-sm mb-4">{s.billerName} {s.serviceLabel.toLowerCase()} · {maskCustomer(s.customer)}</Text>
      <TextInput value={name} onChangeText={(v) => setName(v.slice(0, 40))} placeholder="Name it" placeholderTextColor={colors.muted} style={inputStyle} />
      <Ideas list={NAME_IDEAS[s.service] ?? []} onPick={setName} />
      <BigButton label={busy ? 'Saving…' : 'Save'} disabled={busy || !name.trim()} onPress={() => onSave(name.trim())} />
    </View>
  );
}

function AutopaySheet({ b, busy, onConfirm }: { b: SavedBill; busy: boolean; onConfirm: (day: number, amount?: string) => void }) {
  const [day, setDay] = useState(b.autopayDay ?? Math.min(28, new Date().getDate()));
  const [amount, setAmount] = useState(b.expectedMinor ? String(Number(b.expectedMinor) / 100) : '');
  const needsAmount = !b.planId;
  return (
    <View>
      <Text className="text-ink dark:text-ink-dark font-extrabold text-lg">Autopay {b.nickname}</Text>
      <Text className="text-muted dark:text-muted-dark text-sm mb-4">
        We&apos;ll pay {b.planName ? `${b.billerName} ${b.planName}` : `${b.billerName} ${b.serviceLabel.toLowerCase()}`} for {maskCustomer(b.customer)} from your Naira balance every month. If your balance is too low we skip it and tell you.
      </Text>
      <Text className="text-muted dark:text-muted-dark text-xs font-semibold mb-2">Day of the month: the {ordinal(day)}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
          <TouchableOpacity key={d} onPress={() => setDay(d)} className="w-10 h-10 rounded-full items-center justify-center mr-2" style={{ backgroundColor: d === day ? PURPLE : colors.circle }}>
            <Text style={{ color: d === day ? '#fff' : colors.ink, fontWeight: '700' }}>{d}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      {needsAmount ? (
        <>
          <Text className="text-muted dark:text-muted-dark text-xs font-semibold mt-4 mb-2">Amount (₦)</Text>
          <TextInput value={amount} onChangeText={(v) => setAmount(v.replace(/[^\d]/g, ''))} keyboardType="number-pad" style={inputStyle} />
        </>
      ) : null}
      <BigButton label={busy ? 'Saving…' : 'Turn on autopay'} color={PURPLE} disabled={busy || (needsAmount && !(Number(amount) > 0))} onPress={() => onConfirm(day, needsAmount ? amount : undefined)} />
      <Text className="text-muted dark:text-muted-dark text-xs text-center mt-2">You&apos;ll confirm with your PIN. Turn it off any time.</Text>
    </View>
  );
}

function ManageSheet({ b, busy, onPay, onRename, onAutopay, onDelete }: { b: SavedBill; busy: boolean; onPay: () => void; onRename: (name: string) => void; onAutopay: (on: boolean) => void; onDelete: () => void }) {
  const [name, setName] = useState(b.nickname);
  return (
    <View>
      <Text className="text-ink dark:text-ink-dark font-extrabold text-lg">{b.nickname}</Text>
      <Text className="text-muted dark:text-muted-dark text-sm mb-4">
        {b.billerName} {b.serviceLabel.toLowerCase()} · {maskCustomer(b.customer)}{b.planName ? ` · ${b.planName}` : ''}
      </Text>
      <TextInput value={name} onChangeText={(v) => setName(v.slice(0, 40))} placeholder="Name it" placeholderTextColor={colors.muted} style={inputStyle} />
      {name.trim() && name.trim() !== b.nickname ? (
        <TouchableOpacity disabled={busy} onPress={() => onRename(name.trim())} className="rounded-full py-3 items-center mt-3" style={{ backgroundColor: colors.circle }}>
          <Text className="text-ink dark:text-ink-dark font-bold">Save name</Text>
        </TouchableOpacity>
      ) : null}
      {b.canAutopay ? (
        <View className="flex-row items-center justify-between rounded-2xl p-4 mt-4" style={{ backgroundColor: colors.circle }}>
          <View className="flex-1 mr-3">
            <Text className="text-ink dark:text-ink-dark font-bold">Autopay</Text>
            <Text className="text-muted dark:text-muted-dark text-xs">{b.autopay ? `On, every month on the ${ordinal(b.autopayDay ?? 1)}` : 'Pay it automatically every month'}</Text>
          </View>
          <Toggle on={b.autopay} disabled={busy} onChange={onAutopay} />
        </View>
      ) : null}
      <BigButton label="Pay now" onPress={onPay} />
      <TouchableOpacity disabled={busy} onPress={onDelete} className="items-center py-3 mt-1">
        <Text style={{ color: '#F87171', fontWeight: '600' }}>Remove from my bills</Text>
      </TouchableOpacity>
    </View>
  );
}
