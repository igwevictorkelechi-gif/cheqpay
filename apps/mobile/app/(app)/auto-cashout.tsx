import { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, Switch } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { colors } from '@/components/brand';
import { useTransactionPin, PIN_CANCELLED } from '@/components/TransactionPinProvider';
import {
  api,
  ApiError,
  type AutoCashoutCoin,
  type AutoCashoutRun,
  type AutoCashoutState,
  type Beneficiary,
} from '@/services/api';

const COINS: AutoCashoutCoin[] = ['USDT', 'USDC', 'BTC'];

const STATUS: Record<AutoCashoutRun['status'], { label: string; color: string }> = {
  queued: { label: 'Selling…', color: colors.muted },
  sold: { label: 'Paying out…', color: colors.muted },
  paid: { label: 'Sent to bank', color: '#34D399' },
  skipped: { label: 'Kept as crypto', color: '#FBBF24' },
  kept_ngn: { label: 'Kept as naira', color: '#FBBF24' },
  failed: { label: 'Being checked', color: '#F87171' },
};

/**
 * Auto cash-out: every USDT, USDC or BTC deposit is sold for naira at the
 * current rate and sent to one of the user's own saved bank accounts. The
 * server applies the normal sell rate, withdrawal fee, minimum and limits;
 * this screen only chooses the coins and the account.
 */
export default function AutoCashoutScreen() {
  const insets = useSafeAreaInsets();
  const { authorize } = useTransactionPin();

  const [state, setState] = useState<AutoCashoutState | null>(null);
  const [accounts, setAccounts] = useState<Beneficiary[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [coins, setCoins] = useState<AutoCashoutCoin[]>(['USDT', 'USDC']);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, b] = await Promise.all([api.getAutoCashout(), api.getBeneficiaries()]);
      setState(s);
      setAccounts(b.beneficiaries);
      setEnabled(s.enabled);
      if (s.assets.length) setCoins(s.assets);
      setAccountId(s.beneficiary?.id ?? b.beneficiaries[0]?.id ?? null);
    } catch {
      setError('Couldn’t load your settings. Pull back and try again.');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function toggleCoin(c: AutoCashoutCoin) {
    setSaved(false);
    setCoins((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  }

  async function save(nextEnabled: boolean) {
    setError(null);
    setSaved(false);
    setBusy(true);
    try {
      const input = { enabled: nextEnabled, assets: coins, beneficiaryId: accountId };
      if (nextEnabled) {
        await authorize((pin) => api.setAutoCashout(input, pin), {
          title: 'Turn on auto cash-out',
          detail: 'Enter your transaction PIN to let CheqPay sell crypto you receive and pay it to your bank.',
        });
      } else {
        await api.setAutoCashout(input);
      }
      setEnabled(nextEnabled);
      setSaved(true);
      load();
    } catch (e) {
      if (e instanceof Error && e.message === PIN_CANCELLED) return;
      setError(e instanceof ApiError ? e.message : 'Couldn’t save. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const Header = (
    <View className="flex-row items-center px-5 pt-3 pb-2">
      <TouchableOpacity
        onPress={() => router.back()}
        className="w-10 h-10 rounded-full bg-card dark:bg-card-dark items-center justify-center"
      >
        <Ionicons name="chevron-back" size={22} color={colors.ink} />
      </TouchableOpacity>
      <Text className="text-ink dark:text-ink-dark text-lg font-bold ml-3">Auto cash-out</Text>
    </View>
  );

  if (!state) {
    return (
      <View className="flex-1" style={{ backgroundColor: colors.surface, paddingTop: insets.top }}>
        {Header}
        {error ? (
          <Text className="text-muted dark:text-muted-dark text-sm px-5 mt-4">{error}</Text>
        ) : (
          <ActivityIndicator color={colors.brand} style={{ marginTop: 32 }} />
        )}
      </View>
    );
  }

  if (!state.available) {
    return (
      <View className="flex-1" style={{ backgroundColor: colors.surface, paddingTop: insets.top }}>
        {Header}
        <View className="items-center py-16 px-8">
          <Ionicons name="swap-horizontal-outline" size={36} color={colors.brandLight} />
          <Text className="text-ink dark:text-ink-dark text-lg font-bold mt-4">Not available yet</Text>
          <Text className="text-muted dark:text-muted-dark text-sm mt-1 text-center">
            Auto cash-out isn’t switched on right now.
          </Text>
        </View>
      </View>
    );
  }

  const changed =
    enabled &&
    (accountId !== state.beneficiary?.id ||
      coins.length !== state.assets.length ||
      coins.some((c) => !state.assets.includes(c)));
  const canTurnOn = coins.length > 0 && Boolean(accountId) && !busy;

  return (
    <View className="flex-1" style={{ backgroundColor: colors.surface, paddingTop: insets.top }}>
      {Header}
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 40 }}>
        <Text className="text-muted dark:text-muted-dark text-sm mt-1 mb-5">
          When crypto lands in your wallet, we sell it for naira at the current rate and send it to your bank — no taps
          needed.
        </Text>

        {/* On / off */}
        <View
          className="flex-row items-center justify-between px-4 py-4 rounded-3xl"
          style={{ backgroundColor: colors.card }}
        >
          <View className="flex-1 pr-3">
            <Text className="text-ink dark:text-ink-dark font-bold text-base">
              {enabled ? 'Auto cash-out is on' : 'Auto cash-out is off'}
            </Text>
            <Text className="text-muted dark:text-muted-dark text-xs mt-0.5">
              {enabled && state.beneficiary
                ? `Paying to ${state.beneficiary.label}`
                : 'Deposits stay in your wallet as crypto'}
            </Text>
          </View>
          {busy ? (
            <ActivityIndicator color={colors.brand} />
          ) : (
            <Switch
              value={enabled}
              onValueChange={(v) => save(v)}
              disabled={!enabled && !canTurnOn}
              trackColor={{ true: colors.brand, false: colors.border }}
            />
          )}
        </View>

        {/* Coins */}
        <Text className="text-muted dark:text-muted-dark text-sm font-semibold mt-6 mb-2">Cash out these coins</Text>
        <View className="flex-row" style={{ gap: 8 }}>
          {COINS.map((c) => {
            const on = coins.includes(c);
            return (
              <TouchableOpacity
                key={c}
                onPress={() => toggleCoin(c)}
                className="px-4 py-2 rounded-full flex-row items-center"
                style={{ backgroundColor: on ? colors.brand : colors.card }}
              >
                {on && <Ionicons name="checkmark" size={14} color={colors.white} style={{ marginRight: 4 }} />}
                <Text style={{ color: on ? colors.white : colors.muted, fontWeight: '700', fontSize: 13 }}>{c}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Account */}
        <Text className="text-muted dark:text-muted-dark text-sm font-semibold mt-6 mb-2">Pay to</Text>
        {accounts.length === 0 ? (
          <TouchableOpacity
            onPress={() => router.push('/(app)/bank-accounts')}
            className="px-4 py-4 rounded-3xl flex-row items-center"
            style={{ backgroundColor: colors.card }}
          >
            <Ionicons name="add-circle-outline" size={20} color={colors.brandLight} />
            <Text className="text-ink dark:text-ink-dark font-semibold ml-2">Add a bank account in your name</Text>
          </TouchableOpacity>
        ) : (
          <View className="rounded-3xl overflow-hidden" style={{ backgroundColor: colors.card }}>
            {accounts.map((b, i) => {
              const on = accountId === b.id;
              return (
                <TouchableOpacity
                  key={b.id}
                  onPress={() => {
                    setAccountId(b.id);
                    setSaved(false);
                  }}
                  className="flex-row items-center px-4 py-4"
                  style={i > 0 ? { borderTopWidth: 1, borderTopColor: colors.border } : undefined}
                >
                  <Ionicons
                    name={on ? 'radio-button-on' : 'radio-button-off'}
                    size={20}
                    color={on ? colors.brand : colors.muted}
                  />
                  <View className="ml-3 flex-1">
                    <Text className="text-ink dark:text-ink-dark font-semibold">{b.accountName}</Text>
                    <Text className="text-muted dark:text-muted-dark text-xs">
                      {b.bankName} ••{b.accountNumber.slice(-4)}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* What applies */}
        <View className="mt-6 px-4 py-4 rounded-3xl" style={{ backgroundColor: colors.card }}>
          <Text className="text-ink dark:text-ink-dark font-semibold mb-2">Good to know</Text>
          {[
            'Sold at our current sell rate the moment the deposit confirms.',
            `A ₦${state.payoutFeeNgn.toLocaleString('en-NG')} withdrawal fee comes out of each payout.`,
            `Deposits worth less than ₦${state.minPayoutNgn.toLocaleString('en-NG')} stay in your wallet as crypto.`,
            'Your daily withdrawal limit still applies. Anything over it stays in your wallet.',
            'If the bank can’t be reached, your money stays safe in your wallet and we tell you.',
          ].map((t) => (
            <View key={t} className="flex-row mt-1">
              <Text className="text-muted dark:text-muted-dark text-xs mr-2">•</Text>
              <Text className="text-muted dark:text-muted-dark text-xs flex-1">{t}</Text>
            </View>
          ))}
        </View>

        {error && <Text style={{ color: '#F87171', marginTop: 12 }}>{error}</Text>}
        {saved && !error && <Text style={{ color: '#34D399', marginTop: 12 }}>Saved.</Text>}

        {(changed || (!enabled && canTurnOn)) && (
          <TouchableOpacity
            onPress={() => save(true)}
            disabled={!canTurnOn}
            className="mt-5 flex-row items-center justify-center py-4 rounded-full"
            style={{ backgroundColor: colors.brand, opacity: canTurnOn ? 1 : 0.5 }}
          >
            {busy && <ActivityIndicator color={colors.white} style={{ marginRight: 8 }} />}
            <Text style={{ color: colors.white, fontWeight: '700', fontSize: 16 }}>
              {enabled ? 'Save changes' : 'Turn on auto cash-out'}
            </Text>
          </TouchableOpacity>
        )}

        {/* Recent */}
        {state.runs.length > 0 && (
          <>
            <Text className="text-muted dark:text-muted-dark text-sm font-semibold mt-8 mb-2">Recent</Text>
            <View className="rounded-3xl overflow-hidden" style={{ backgroundColor: colors.card }}>
              {state.runs.map((r, i) => (
                <View
                  key={r.id}
                  className="px-4 py-4"
                  style={i > 0 ? { borderTopWidth: 1, borderTopColor: colors.border } : undefined}
                >
                  <View className="flex-row justify-between">
                    <Text className="text-ink dark:text-ink-dark font-semibold">
                      {r.amount} {r.coin}
                      {r.payout ? `  →  ₦${Number(r.payout).toLocaleString('en-NG')}` : ''}
                    </Text>
                    <Text style={{ color: STATUS[r.status].color, fontSize: 12, fontWeight: '700' }}>
                      {STATUS[r.status].label}
                    </Text>
                  </View>
                  {r.reason && (r.status === 'skipped' || r.status === 'kept_ngn' || r.status === 'failed') && (
                    <Text className="text-muted dark:text-muted-dark text-xs mt-1">{r.reason}</Text>
                  )}
                </View>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}
