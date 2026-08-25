import { useEffect, useState } from 'react';
import { ActivityIndicator, View, Text, TextInput, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { colors, NairaFlag } from '@/components/brand';
import { api, type UsdAccount } from '@/services/api';

/** A USD account can exist but still be in review — only an approved one can receive. */
function isUsable(account: UsdAccount | null): boolean {
  if (!account) return false;
  if (account.consentRequired) return false;
  // No status at all is treated as usable: older accounts predate status
  // tracking, and blocking them would lock out users who can already receive.
  if (!account.status) return true;
  return /approv|active|success/i.test(account.status);
}

export default function AddMoneyScreen() {
  const insets = useSafeAreaInsets();
  const { currency: currencyParam } = useLocalSearchParams<{ currency?: string }>();
  const isUsd = String(currencyParam ?? '').toUpperCase() === 'USD';
  const currency = isUsd ? 'USD' : 'NGN';
  const locale = isUsd ? 'en-US' : 'en-NG';

  const [amount, setAmount] = useState('1000');
  const [balance, setBalance] = useState(0);
  const [usdAccount, setUsdAccount] = useState<UsdAccount | null>(null);
  const [checkingUsd, setCheckingUsd] = useState(isUsd);

  useEffect(() => {
    (async () => {
      try {
        await api.ensureProvisioned();
        const [{ balances }, usd] = await Promise.all([
          api.getBalances(),
          isUsd ? api.getUsdAccount().catch(() => ({ usdAccount: null })) : Promise.resolve(null),
        ]);
        setBalance(Number(balances.find((b) => b.asset === currency)?.availableFormatted ?? 0));
        if (usd) setUsdAccount(usd.usdAccount);
      } catch {
        /* ignore */
      } finally {
        setCheckingUsd(false);
      }
    })();
  }, [isUsd, currency]);

  const digits = amount.replace(/\D/g, '');
  const display = digits ? Number(digits).toLocaleString(locale) : '0';
  const valid = Number(digits) > 0;
  // Dollars can only be received once the USD account is open and approved.
  const blocked = isUsd && !checkingUsd && !isUsable(usdAccount);

  function proceed() {
    if (!valid) return;
    // Deposits arrive by bank transfer into the user's virtual account and are
    // credited by the Maplerad collection webhook. There is nothing to record up
    // front, so go straight to the funding details.
    router.push(
      isUsd
        ? '/(app)/virtual-account'
        : { pathname: '/(app)/virtual-account', params: { amount: digits } },
    );
  }

  return (
    <View
      className="flex-1 px-5"
      style={{ backgroundColor: colors.surface, paddingTop: insets.top + 8, paddingBottom: 12 }}
    >
      {/* Header */}
      <TouchableOpacity
        onPress={() => router.back()}
        className="w-11 h-11 rounded-full bg-card dark:bg-card-dark items-center justify-center"
      >
        <Ionicons name="arrow-back" size={22} color={colors.ink} />
      </TouchableOpacity>

      <View className="flex-row items-center justify-between mt-5">
        <Text className="text-ink dark:text-ink-dark text-4xl font-extrabold">
          {isUsd ? 'Add dollars' : 'Add money'}
        </Text>
        {isUsd ? (
          <View
            className="rounded-full items-center justify-center"
            style={{ width: 48, height: 48, backgroundColor: 'rgba(34,197,94,0.15)' }}
          >
            <Text style={{ color: '#22C55E', fontSize: 24, fontWeight: '700' }}>$</Text>
          </View>
        ) : (
          <NairaFlag size={48} />
        )}
      </View>

      {checkingUsd ? (
        <View className="mt-16 items-center">
          <ActivityIndicator color={colors.brand} />
        </View>
      ) : blocked ? (
        // ---- USD account not open (or still in review) ----
        <>
          <View className="bg-card dark:bg-card-dark rounded-3xl p-6 mt-8 items-center">
            <View
              className="rounded-2xl items-center justify-center"
              style={{ width: 56, height: 56, backgroundColor: 'rgba(245,158,11,0.15)' }}
            >
              <Ionicons name="shield-half-outline" size={28} color="#F59E0B" />
            </View>
            <Text className="text-ink dark:text-ink-dark text-xl font-extrabold mt-4 text-center">
              {usdAccount ? 'Your dollar account is being verified' : 'Verify your dollar account'}
            </Text>
            <Text className="text-muted dark:text-muted-dark text-sm mt-2 text-center">
              {usdAccount
                ? 'We’re reviewing your details. You’ll be able to receive dollars as soon as it’s approved — check the status on your account page.'
                : 'A dollar account needs a few extra details for US banking compliance before it can receive money. It only takes a minute.'}
            </Text>
          </View>

          <View className="flex-1 justify-end">
            <TouchableOpacity
              onPress={() => router.push('/(app)/virtual-account')}
              className="rounded-full py-4 items-center"
              style={{ backgroundColor: colors.brand }}
              activeOpacity={0.85}
            >
              <Text className="text-white text-base font-bold">
                {usdAccount ? 'Check status' : 'Verify my dollar account'}
              </Text>
            </TouchableOpacity>
          </View>
        </>
      ) : (
        <>
          {/* Amount */}
          <View className="bg-card dark:bg-card-dark rounded-3xl p-5 mt-6">
            <View className="flex-row items-center justify-between">
              <View className="flex-1">
                <Text className="text-muted dark:text-muted-dark text-sm">Enter amount</Text>
                <TextInput
                  value={display}
                  onChangeText={(t) => setAmount(t.replace(/\D/g, ''))}
                  keyboardType="number-pad"
                  className="text-ink dark:text-ink-dark text-4xl font-extrabold mt-1"
                  style={{ padding: 0 }}
                  placeholderTextColor={colors.muted}
                />
              </View>
              <View className="flex-row items-center" style={{ gap: 8 }}>
                {isUsd ? (
                  <Text style={{ color: '#22C55E', fontSize: 20, fontWeight: '700' }}>$</Text>
                ) : (
                  <NairaFlag size={28} />
                )}
                <Text className="text-ink dark:text-ink-dark text-xl font-bold">{currency}</Text>
              </View>
            </View>
          </View>
          <Text className="text-muted dark:text-muted-dark text-sm mt-3">
            Available: {balance.toLocaleString(locale, { maximumFractionDigits: 2 })} {currency}
          </Text>

          {/* Pay with */}
          <Text className="text-ink dark:text-ink-dark text-base font-bold mt-8">Pay with</Text>
          <View className="flex-row items-center bg-card dark:bg-card-dark rounded-3xl p-5 mt-3" style={{ gap: 16 }}>
            <View className="w-14 h-14 rounded-full items-center justify-center" style={{ backgroundColor: colors.circle }}>
              <Ionicons name="business-outline" size={24} color={colors.ink} />
            </View>
            <View className="flex-1">
              <Text className="text-ink dark:text-ink-dark text-lg font-bold">
                {isUsd ? 'Bank / wire transfer' : 'Bank Transfer'}
              </Text>
              <Text className="text-muted dark:text-muted-dark text-sm mt-0.5">
                {isUsd
                  ? 'Send dollars to your account details from anywhere.'
                  : '150 NGN Fees. Usually arrives in seconds'}
              </Text>
            </View>
          </View>

          {/* CTA */}
          <View className="flex-1 justify-end">
            <TouchableOpacity
              disabled={!valid}
              onPress={proceed}
              className="rounded-full py-4 items-center"
              style={{ backgroundColor: colors.brand, opacity: valid ? 1 : 0.5 }}
              activeOpacity={0.85}
            >
              <Text className="text-white text-base font-bold">Continue</Text>
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>
  );
}
