import { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, TextInput, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { colors } from '@/components/brand';
import { api, ApiError, type BillCashback, type BillServiceConfig } from '@/services/api';
import DataPlanGrid from '@/components/DataPlanGrid';

type Stage = 'form' | 'review' | 'done';

function contrast(hex: string): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? '#111' : '#fff';
}

export default function BillServiceScreen() {
  const insets = useSafeAreaInsets();
  const { service: serviceParam } = useLocalSearchParams<{ service: string }>();
  const service = String(serviceParam ?? '').toLowerCase();

  const [config, setConfig] = useState<BillServiceConfig | null>(null);
  const [cashback, setCashback] = useState<BillCashback | undefined>();
  const [loading, setLoading] = useState(true);
  const [balance, setBalance] = useState(0);
  const [billerId, setBillerId] = useState('');
  const [customer, setCustomer] = useState('');
  const [planId, setPlanId] = useState('');
  const [amount, setAmount] = useState('');
  const [validating, setValidating] = useState(false);
  const [customerName, setCustomerName] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>('form');
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [providerRef, setProviderRef] = useState<string | undefined>();
  // Data uses a compact network chip that expands into the full picker, so the
  // plan grid gets the screen instead of a permanent row of logos.
  const [networkOpen, setNetworkOpen] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { services, cashback: cb } = await api.getBillCatalog();
        const c = services.find((s) => s.service === service) ?? null;
        setConfig(c);
        setCashback(cb);
        if (c) setBillerId(c.billers.find((b) => !b.comingSoon)?.id ?? '');
        await api.ensureProvisioned();
        const { balances } = await api.getBalances();
        setBalance(Number(balances.find((b) => b.asset === 'NGN')?.availableFormatted ?? 0));
      } catch {
        /* ignore */
      } finally {
        setLoading(false);
      }
    })();
  }, [service]);

  useEffect(() => {
    setCustomerName(null);
  }, [billerId, customer]);

  const plans = useMemo(
    () => (config ? config.plans.filter((p) => p.billerId === billerId) : []),
    [config, billerId]
  );
  const isData = service === 'data';
  const selectedBiller = config?.billers.find((b) => b.id === billerId);
  const selectedPlan = plans.find((p) => p.id === planId);
  const payAmount = config?.variableAmount ? Number(amount || 0) : Number(selectedPlan?.amount ?? 0);
  const biller = config?.billers.find((b) => b.id === billerId);

  async function validate() {
    if (!config) return;
    setError(null);
    setValidating(true);
    try {
      const res = await api.validateBillCustomer({ service, billerId, customer });
      setCustomerName(res.customerName ?? 'Verified');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not validate customer');
    } finally {
      setValidating(false);
    }
  }

  function goReview() {
    setError(null);
    if (!billerId) return setError('Select a provider.');
    if (customer.trim().length < 3) return setError(`Enter a valid ${config?.customerLabel}.`);
    if (config?.requiresValidation && !customerName) return setError('Please verify the customer first.');
    if (config?.variableAmount) {
      if (!(payAmount > 0)) return setError('Enter a valid amount.');
    } else if (!selectedPlan) {
      return setError('Select a plan.');
    }
    if (payAmount > balance) return setError('Amount exceeds your NGN balance.');
    setStage('review');
  }

  async function confirm() {
    if (!config) return;
    setProcessing(true);
    setError(null);
    try {
      const res = await api.payBill({
        service,
        billerId,
        customer: customer.trim(),
        ...(config.variableAmount ? { amount: String(payAmount) } : { planId }),
      });
      setProviderRef(res.providerRef);
      setStage('done');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Payment failed');
      setStage('review');
    } finally {
      setProcessing(false);
    }
  }

  const showHistory = isData && stage === 'form';
  const Header = (
    <View className="flex-row items-center px-5 pt-3 pb-2">
      <TouchableOpacity
        onPress={() => (stage === 'review' ? setStage('form') : router.back())}
        className="w-10 h-10 rounded-full bg-card dark:bg-card-dark items-center justify-center"
      >
        <Ionicons name="chevron-back" size={22} color={colors.ink} />
      </TouchableOpacity>
      {isData ? (
        // Centred between the two controls, the way the rest of the money
        // screens title themselves.
        <Text
          className="text-ink dark:text-ink-dark text-lg font-bold flex-1 text-center"
          numberOfLines={1}
        >
          Mobile Data
        </Text>
      ) : (
        <Text className="text-ink dark:text-ink-dark text-lg font-bold ml-3">
          {config ? config.label : 'Pay bill'}
        </Text>
      )}
      {isData ? (
        <TouchableOpacity
          onPress={() => router.push('/(app)/activity')}
          disabled={!showHistory}
          style={{ minWidth: 40, minHeight: 44, justifyContent: 'center', alignItems: 'flex-end' }}
        >
          <Text
            className="font-semibold text-base"
            style={{ color: showHistory ? colors.brandLight : 'transparent' }}
          >
            History
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );

  if (loading) {
    return (
      <View className="flex-1" style={{ backgroundColor: colors.surface, paddingTop: insets.top }}>
        {Header}
        <ActivityIndicator color={colors.brand} style={{ marginTop: 40 }} />
      </View>
    );
  }
  if (!config) {
    return (
      <View className="flex-1" style={{ backgroundColor: colors.surface, paddingTop: insets.top }}>
        {Header}
        <Text className="text-muted dark:text-muted-dark text-center mt-10 px-5">This service is unavailable.</Text>
      </View>
    );
  }

  return (
    <View className="flex-1" style={{ backgroundColor: colors.surface, paddingTop: insets.top }}>
      {Header}
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 32 }}>
        {stage === 'form' && (
          <View className="px-5">
            <Text className="text-muted dark:text-muted-dark text-sm">
              NGN balance: <Text className="text-ink dark:text-ink-dark font-semibold">₦{balance.toLocaleString()}</Text>
            </Text>

            {isData ? (
              /* Network + number on one line: the network is a chip that
                 expands into the picker, so the plans get the screen. */
              <View className="rounded-3xl p-4 mt-4" style={{ backgroundColor: colors.card }}>
                <View className="flex-row items-center">
                  <TouchableOpacity
                    onPress={() => setNetworkOpen((o) => !o)}
                    accessibilityLabel="Change network"
                    activeOpacity={0.8}
                    className="flex-row items-center"
                    style={{ minHeight: 44 }}
                  >
                    <View
                      className="w-11 h-11 rounded-full items-center justify-center"
                      style={{ backgroundColor: selectedBiller?.color ?? colors.circle }}
                    >
                      <Text
                        style={{
                          color: selectedBiller ? contrast(selectedBiller.color) : colors.ink,
                          fontWeight: '800',
                          fontSize: 11,
                        }}
                      >
                        {selectedBiller?.short ?? '—'}
                      </Text>
                    </View>
                    <Ionicons
                      name={networkOpen ? 'chevron-up' : 'chevron-down'}
                      size={14}
                      color={colors.muted}
                      style={{ marginLeft: 4 }}
                    />
                  </TouchableOpacity>

                  <View
                    style={{ width: 1, height: 36, backgroundColor: colors.border, marginHorizontal: 12 }}
                  />

                  <TextInput
                    value={customer}
                    onChangeText={setCustomer}
                    placeholder={config.customerPlaceholder}
                    placeholderTextColor={colors.muted}
                    keyboardType="phone-pad"
                    accessibilityLabel={config.customerLabel}
                    className="flex-1 text-ink dark:text-ink-dark"
                    style={{ fontSize: 22, fontWeight: '700' }}
                  />
                </View>

                {networkOpen ? (
                  <View
                    className="flex-row flex-wrap mt-4 pt-4"
                    style={{ borderTopWidth: 1, borderTopColor: colors.border }}
                  >
                    {config.billers.map((b) => {
                      const active = billerId === b.id;
                      return (
                        <TouchableOpacity
                          key={b.id}
                          disabled={b.comingSoon}
                          onPress={() => {
                            setBillerId(b.id);
                            setPlanId('');
                            setNetworkOpen(false);
                          }}
                          activeOpacity={0.8}
                          className="items-center rounded-2xl p-2"
                          style={{
                            width: '25%',
                            opacity: b.comingSoon ? 0.4 : 1,
                            backgroundColor: active ? colors.circle : 'transparent',
                          }}
                        >
                          <View
                            className="w-9 h-9 rounded-xl items-center justify-center"
                            style={{ backgroundColor: b.color }}
                          >
                            <Text
                              style={{ color: contrast(b.color), fontWeight: '800', fontSize: 10 }}
                            >
                              {b.short}
                            </Text>
                          </View>
                          <Text
                            className="text-ink dark:text-ink-dark font-semibold mt-1.5"
                            style={{ fontSize: 11 }}
                            numberOfLines={1}
                          >
                            {b.name}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                ) : null}
              </View>
            ) : (
              <>
              <Text className="text-muted dark:text-muted-dark text-sm font-semibold mt-5 mb-2">Select provider</Text>
              <View className="flex-row flex-wrap" style={{ gap: 8 }}>
                {config.billers.map((b) => {
                  const active = billerId === b.id;
                  return (
                    <TouchableOpacity
                      key={b.id}
                      disabled={b.comingSoon}
                      onPress={() => {
                        setBillerId(b.id);
                        setPlanId('');
                      }}
                      className="rounded-2xl p-3 items-center"
                      style={{
                        width: '31%',
                        backgroundColor: colors.card,
                        borderWidth: 1,
                        borderColor: active ? colors.brand : colors.border,
                        opacity: b.comingSoon ? 0.5 : 1,
                      }}
                      activeOpacity={0.8}
                    >
                      {b.comingSoon && (
                        <Text
                          style={{
                            position: 'absolute',
                            top: 6,
                            right: 6,
                            color: '#FBBF24',
                            fontSize: 9,
                            fontWeight: '800',
                          }}
                        >
                          SOON
                        </Text>
                      )}
                      <View
                        className="w-12 h-12 rounded-xl items-center justify-center"
                        style={{ backgroundColor: b.color }}
                      >
                        <Text style={{ color: contrast(b.color), fontWeight: '800', fontSize: 11 }}>
                          {b.short}
                        </Text>
                      </View>
                      <Text className="text-ink dark:text-ink-dark text-xs font-semibold mt-2" numberOfLines={1}>
                        {b.name}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text className="text-muted dark:text-muted-dark text-sm font-semibold mt-6 mb-2">{config.customerLabel}</Text>
              <View className="flex-row" style={{ gap: 8 }}>
                <TextInput
                  value={customer}
                  onChangeText={setCustomer}
                  placeholder={config.customerPlaceholder}
                  placeholderTextColor={colors.muted}
                  className="flex-1 rounded-2xl px-4 py-3 text-ink dark:text-ink-dark"
                  style={{ backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}
                />
                {config.requiresValidation && (
                  <TouchableOpacity
                    onPress={validate}
                    disabled={validating || customer.trim().length < 3}
                    className="rounded-2xl px-4 items-center justify-center"
                    style={{ backgroundColor: colors.card, opacity: validating ? 0.6 : 1 }}
                  >
                    {validating ? (
                      <ActivityIndicator color={colors.brandLight} />
                    ) : (
                      <Text style={{ color: colors.brandLight, fontWeight: '700' }}>Verify</Text>
                    )}
                  </TouchableOpacity>
                )}
              </View>
              {customerName && (
                <Text style={{ color: colors.positive }} className="text-sm mt-2">
                  ✓ {customerName}
                </Text>
              )}
              </>
            )}

            {config.variableAmount ? (
              <>
                <Text className="text-muted dark:text-muted-dark text-sm font-semibold mt-6 mb-2">Amount</Text>
                <View
                  className="flex-row items-center rounded-2xl px-4 py-3"
                  style={{ backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}
                >
                  <Text className="text-muted dark:text-muted-dark text-lg font-bold mr-1">₦</Text>
                  <TextInput
                    value={amount}
                    onChangeText={(t) => setAmount(t.replace(/[^\d.]/g, ''))}
                    keyboardType="decimal-pad"
                    placeholder="0"
                    placeholderTextColor={colors.muted}
                    className="flex-1 text-ink dark:text-ink-dark text-lg font-bold"
                  />
                </View>
                <View className="flex-row flex-wrap mt-3" style={{ gap: 8 }}>
                  {[100, 200, 500, 1000, 2000].map((v) => (
                    <TouchableOpacity
                      key={v}
                      onPress={() => setAmount(String(v))}
                      className="rounded-full px-4 py-2"
                      style={{ backgroundColor: colors.card }}
                    >
                      <Text className="text-ink dark:text-ink-dark text-sm font-semibold">₦{v.toLocaleString()}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            ) : (
              <>
                {service === 'data' ? (
                  // Data bundles come back ranked by value, so they get the grid
                  // that leads with the best deals rather than a flat list.
                  <DataPlanGrid
                    plans={plans}
                    selectedId={planId}
                    onSelect={setPlanId}
                    cashback={cashback}
                  />
                ) : (
                  <>
                    <Text className="text-muted dark:text-muted-dark text-sm font-semibold mt-6 mb-2">Select plan</Text>
                    {plans.map((p) => {
                      const active = planId === p.id;
                      return (
                        <TouchableOpacity
                          key={p.id}
                          onPress={() => setPlanId(p.id)}
                          className="flex-row items-center justify-between rounded-2xl p-4 mb-2"
                          style={{
                            backgroundColor: colors.card,
                            borderWidth: 1,
                            borderColor: active ? colors.brand : colors.border,
                          }}
                        >
                          <Text className="text-ink dark:text-ink-dark font-semibold">{p.name}</Text>
                          <Text className="text-ink dark:text-ink-dark font-bold">₦{Number(p.amount).toLocaleString()}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </>
                )}
              </>
            )}

            {error && <Text style={{ color: '#FF6B6B' }} className="text-sm mt-4">{error}</Text>}

            <TouchableOpacity
              onPress={goReview}
              className="rounded-full py-4 items-center mt-6"
              style={{ backgroundColor: colors.brand }}
            >
              <Text className="text-white font-bold text-base">Continue</Text>
            </TouchableOpacity>
          </View>
        )}

        {stage === 'review' && (
          <View className="px-5">
            <View className="items-center mt-2 mb-5">
              {biller && (
                <View
                  className="w-16 h-16 rounded-2xl items-center justify-center"
                  style={{ backgroundColor: biller.color }}
                >
                  <Text style={{ color: contrast(biller.color), fontWeight: '800' }}>{biller.short}</Text>
                </View>
              )}
              <Text className="text-ink dark:text-ink-dark text-lg font-bold mt-3">{biller?.name}</Text>
              <Text className="text-muted dark:text-muted-dark text-sm">{config.label}</Text>
            </View>
            <View className="rounded-2xl overflow-hidden" style={{ backgroundColor: colors.card }}>
              <ReviewRow label={config.customerLabel} value={customer.trim()} />
              {customerName ? <ReviewRow label="Name" value={customerName} bordered /> : null}
              {selectedPlan ? <ReviewRow label="Plan" value={selectedPlan.name} bordered /> : null}
              <ReviewRow label="Amount" value={`₦${payAmount.toLocaleString()}`} bordered />
            </View>

            {error && <Text style={{ color: '#FF6B6B' }} className="text-sm mt-4">{error}</Text>}

            <TouchableOpacity
              onPress={confirm}
              disabled={processing}
              className="rounded-full py-4 items-center mt-6"
              style={{ backgroundColor: colors.brand, opacity: processing ? 0.6 : 1 }}
            >
              <Text className="text-white font-bold text-base">
                {processing ? 'Processing…' : `Pay ₦${payAmount.toLocaleString()}`}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {stage === 'done' && (
          <View className="px-5 items-center pt-10">
            <View
              className="w-20 h-20 rounded-full items-center justify-center"
              style={{ backgroundColor: 'rgba(52,199,89,0.15)' }}
            >
              <Ionicons name="checkmark-circle" size={64} color={colors.positive} />
            </View>
            <Text className="text-ink dark:text-ink-dark text-2xl font-extrabold mt-6">Payment successful</Text>
            <Text className="text-muted dark:text-muted-dark text-sm mt-2 text-center">
              ₦{payAmount.toLocaleString()} {config.label} for {customer.trim()}.
            </Text>
            {providerRef ? (
              <Text className="text-muted dark:text-muted-dark text-xs mt-3">Ref: {providerRef}</Text>
            ) : null}
            <TouchableOpacity
              onPress={() => router.replace('/(app)/pay-bill')}
              className="rounded-full py-4 items-center mt-8 w-full"
              style={{ backgroundColor: colors.brand }}
            >
              <Text className="text-white font-bold text-base">Done</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function ReviewRow({ label, value, bordered }: { label: string; value: string; bordered?: boolean }) {
  return (
    <View
      className="flex-row items-center justify-between px-4 py-4"
      style={bordered ? { borderTopWidth: 1, borderTopColor: colors.border } : undefined}
    >
      <Text className="text-muted dark:text-muted-dark text-sm">{label}</Text>
      <Text className="text-ink dark:text-ink-dark text-sm font-semibold" style={{ maxWidth: '60%' }} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}
