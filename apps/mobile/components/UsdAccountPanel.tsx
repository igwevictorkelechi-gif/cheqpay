import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/components/brand';
import {
  api,
  ApiError,
  type UsdAccount,
  type UsdAccountStatus,
  type UsdWireDetails,
} from '@/services/api';

const EMPLOYMENT = [
  { value: 'EMPLOYED', label: 'Employed' },
  { value: 'SELF_EMPLOYED', label: 'Self-employed' },
  { value: 'STUDENT', label: 'Student' },
  { value: 'UNEMPLOYED', label: 'Unemployed' },
  { value: 'RETIRED', label: 'Retired' },
];
const RESIDENCY = [
  { value: 'NON_RESIDENT_ALIEN', label: 'Non-resident alien' },
  { value: 'RESIDENT_ALIEN', label: 'Resident alien' },
  { value: 'US_CITIZEN', label: 'US citizen' },
];

/**
 * The USD account, behind a switch. Self-contained so the NGN flow on the screen
 * is untouched. A USD account needs US-banking KYC the NGN one never asked for,
 * and may require the holder to consent to US banking terms before it activates.
 */
export default function UsdAccountPanel() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [account, setAccount] = useState<UsdAccount | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState<UsdAccountStatus | null>(null);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [wire, setWire] = useState<UsdWireDetails | null>(null);
  const [wireLoading, setWireLoading] = useState(false);
  const [wireError, setWireError] = useState<string | null>(null);

  const [idNumber, setIdNumber] = useState('');
  const [employmentStatus, setEmploymentStatus] = useState('EMPLOYED');
  const [employmentDescription, setEmploymentDescription] = useState('');
  const [employerName, setEmployerName] = useState('');
  const [residency, setResidency] = useState('NON_RESIDENT_ALIEN');
  const [submitting, setSubmitting] = useState(false);

  const loadOnce = useCallback(async () => {
    if (loaded || loading) return;
    setLoading(true);
    setError(null);
    try {
      const [{ usdAccount }, balancesRes] = await Promise.all([
        api.getUsdAccount(),
        api.getBalances().catch(() => ({ balances: [] })),
      ]);
      setAccount(usdAccount);
      setBalance(balancesRes.balances.find((b) => b.asset === 'USD')?.availableFormatted ?? '0.00');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load your USD account.');
    } finally {
      setLoaded(true);
      setLoading(false);
    }
  }, [loaded, loading]);

  useEffect(() => {
    if (open) void loadOnce();
  }, [open, loadOnce]);

  const canSubmit =
    idNumber.trim().length >= 3 &&
    employmentDescription.trim().length >= 2 &&
    employerName.trim().length >= 1 &&
    !submitting;

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const { usdAccount } = await api.createUsdAccount({
        identificationNumber: idNumber.trim(),
        employmentStatus,
        employmentDescription: employmentDescription.trim(),
        nationality: 'NG',
        employerName: employerName.trim(),
        usResidencyStatus: residency,
      });
      setAccount(usdAccount);
    } catch (e) {
      const notEnrolled =
        e instanceof ApiError &&
        (e.status === 409 ||
          (typeof e.body === 'object' &&
            e.body !== null &&
            (e.body as { code?: string }).code === 'not_enrolled'));
      setError(
        notEnrolled
          ? 'Finish identity verification first, then open your USD account.'
          : e instanceof ApiError
            ? e.message
            : 'Could not open your USD account. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function copy(text: string) {
    await Clipboard.setStringAsync(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  async function checkStatus() {
    setStatusError(null);
    setCheckingStatus(true);
    try {
      const { usdStatus } = await api.getUsdAccountStatus();
      if (usdStatus) setStatus(usdStatus);
      else setStatusError('Status is not available for this account yet.');
    } catch (e) {
      setStatusError(e instanceof ApiError ? e.message : 'Could not check the status.');
    } finally {
      setCheckingStatus(false);
    }
  }

  async function loadWire() {
    if (wire) {
      setWire(null);
      return;
    }
    setWireError(null);
    setWireLoading(true);
    try {
      const { wire: w } = await api.getUsdAccountWire();
      if (w && w.instructions.length > 0) setWire(w);
      else setWireError('Wire details are not available for this account yet.');
    } catch (e) {
      setWireError(e instanceof ApiError ? e.message : 'Could not load wire details.');
    } finally {
      setWireLoading(false);
    }
  }

  const statusTone = (s: string) =>
    /approv|active|success/i.test(s)
      ? { bg: 'rgba(34,197,94,0.15)', fg: '#16A34A' }
      : /declin|reject|fail/i.test(s)
        ? { bg: 'rgba(239,68,68,0.15)', fg: '#EF4444' }
        : { bg: 'rgba(245,158,11,0.15)', fg: '#B45309' };

  const chipRow = (
    options: { value: string; label: string }[],
    selected: string,
    onSelect: (v: string) => void,
  ) => (
    <View className="flex-row flex-wrap" style={{ gap: 8 }}>
      {options.map((o) => {
        const active = o.value === selected;
        return (
          <TouchableOpacity
            key={o.value}
            onPress={() => onSelect(o.value)}
            className="rounded-full px-3 py-2"
            style={{
              backgroundColor: active ? colors.brand : colors.surface,
              borderWidth: 1,
              borderColor: active ? colors.brand : colors.border,
            }}
          >
            <Text style={{ color: active ? '#fff' : colors.ink, fontSize: 12, fontWeight: '600' }}>
              {o.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  const input = (
    value: string,
    onChangeText: (v: string) => void,
    placeholder: string,
  ) => (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={colors.muted}
      className="rounded-2xl px-4 py-3 text-ink dark:text-ink-dark"
      style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}
    />
  );

  return (
    <View className="rounded-3xl p-5 mt-6" style={{ backgroundColor: colors.card }}>
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center" style={{ gap: 12 }}>
          <View
            className="rounded-2xl items-center justify-center"
            style={{ width: 40, height: 40, backgroundColor: 'rgba(34,197,94,0.15)' }}
          >
            <Ionicons name="logo-usd" size={20} color="#22C55E" />
          </View>
          <View>
            <Text className="text-ink dark:text-ink-dark font-bold text-sm">USD account</Text>
            <Text style={{ color: colors.muted, fontSize: 12 }}>Receive US dollars</Text>
          </View>
        </View>
        <Switch
          value={open}
          onValueChange={setOpen}
          trackColor={{ false: colors.border, true: colors.brand }}
        />
      </View>

      {open && (
        <View className="mt-5 pt-5" style={{ borderTopWidth: 1, borderTopColor: colors.border }}>
          {loading ? (
            <ActivityIndicator color={colors.brand} />
          ) : account ? (
            <>
              <View className="rounded-2xl px-4 py-3 mb-4" style={{ backgroundColor: 'rgba(34,197,94,0.10)' }}>
                <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '700' }}>USD BALANCE</Text>
                <Text className="text-ink dark:text-ink-dark font-extrabold" style={{ fontSize: 22, marginTop: 2 }}>
                  ${balance ?? '0.00'}
                </Text>
              </View>
              <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '700' }}>BANK NAME</Text>
              <Text className="text-ink dark:text-ink-dark font-semibold mt-1">{account.bankName}</Text>
              <View className="my-3 h-px" style={{ backgroundColor: colors.border }} />
              <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '700' }}>ACCOUNT NUMBER</Text>
              <View className="flex-row items-center justify-between mt-1">
                <Text className="text-ink dark:text-ink-dark font-extrabold" style={{ fontSize: 22 }}>
                  {account.accountNumber}
                </Text>
                <TouchableOpacity
                  onPress={() => copy(account.accountNumber)}
                  className="flex-row items-center rounded-full px-3 py-2"
                  style={{ backgroundColor: colors.surface }}
                >
                  <Ionicons
                    name={copied ? 'checkmark' : 'copy-outline'}
                    size={16}
                    color={copied ? colors.positive : colors.ink}
                  />
                  <Text className="text-ink dark:text-ink-dark font-bold ml-1.5">
                    {copied ? 'Copied' : 'Copy'}
                  </Text>
                </TouchableOpacity>
              </View>
              {account.accountName ? (
                <Text style={{ color: colors.muted, marginTop: 8 }}>Account name: {account.accountName}</Text>
              ) : null}
              {account.consentRequired && account.consentUrl ? (
                <TouchableOpacity
                  onPress={() => Linking.openURL(account.consentUrl as string)}
                  className="rounded-full px-4 py-3 mt-4 flex-row items-center justify-center"
                  style={{ backgroundColor: 'rgba(245,158,11,0.15)' }}
                >
                  <Text style={{ color: '#B45309', fontWeight: '700' }}>Consent required — finish activation</Text>
                  <Ionicons name="open-outline" size={16} color="#B45309" style={{ marginLeft: 6 }} />
                </TouchableOpacity>
              ) : null}

              {/* Wire / international transfer details (ACH / FEDWIRE / SWIFT). */}
              <View className="mt-4 pt-4" style={{ borderTopWidth: 1, borderTopColor: colors.border }}>
                <TouchableOpacity onPress={loadWire} disabled={wireLoading}>
                  <Text style={{ color: colors.brand, fontWeight: '700', opacity: wireLoading ? 0.5 : 1 }}>
                    {wireLoading
                      ? 'Loading…'
                      : wire
                        ? 'Hide wire details'
                        : 'Show wire / international transfer details'}
                  </Text>
                </TouchableOpacity>
                {wire
                  ? wire.instructions.map((ins, i) => (
                      <View
                        key={i}
                        className="rounded-2xl p-3 mt-3"
                        style={{ backgroundColor: colors.surface }}
                      >
                        <Text style={{ color: colors.brand, fontWeight: '700', fontSize: 11 }}>
                          {ins.type}
                        </Text>
                        {[
                          ['Bank', ins.bankName],
                          ['Account name', ins.accountName],
                          ['Account number', ins.accountNumber],
                          ['Routing', ins.routingNumber],
                          ['SWIFT', ins.swiftCode],
                          ['Account type', ins.accountType],
                          ['Memo', ins.memo],
                        ]
                          .filter(([, v]) => v)
                          .map(([label, v]) => (
                            <View key={label} className="flex-row justify-between mt-1.5" style={{ gap: 12 }}>
                              <Text style={{ color: colors.muted, fontSize: 12 }}>{label}</Text>
                              <TouchableOpacity onPress={() => copy(String(v))} style={{ flexShrink: 1 }}>
                                <Text
                                  className="text-ink dark:text-ink-dark"
                                  style={{ fontSize: 12, fontWeight: '600', textAlign: 'right' }}
                                >
                                  {v}
                                </Text>
                              </TouchableOpacity>
                            </View>
                          ))}
                      </View>
                    ))
                  : null}
                {wireError ? <Text style={{ color: '#EF4444', marginTop: 8 }}>{wireError}</Text> : null}
              </View>

              {/* Application status — Maplerad reviews the KYC before approval. */}
              <View className="mt-4 pt-4" style={{ borderTopWidth: 1, borderTopColor: colors.border }}>
                <View className="flex-row items-center justify-between">
                  <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '700' }}>
                    APPLICATION STATUS
                  </Text>
                  <TouchableOpacity
                    onPress={checkStatus}
                    disabled={checkingStatus}
                    className="flex-row items-center rounded-full px-3 py-1.5"
                    style={{ backgroundColor: colors.surface, opacity: checkingStatus ? 0.5 : 1 }}
                  >
                    <Ionicons name="refresh" size={14} color={colors.ink} />
                    <Text className="text-ink dark:text-ink-dark font-bold ml-1.5" style={{ fontSize: 12 }}>
                      {checkingStatus ? 'Checking…' : 'Check status'}
                    </Text>
                  </TouchableOpacity>
                </View>
                {status ? (
                  <View className="mt-3">
                    <View
                      className="self-start rounded-full px-3 py-1"
                      style={{ backgroundColor: statusTone(status.status).bg }}
                    >
                      <Text style={{ color: statusTone(status.status).fg, fontWeight: '700', fontSize: 12 }}>
                        {status.status}
                      </Text>
                    </View>
                    {status.messages.map((m, i) => (
                      <Text key={i} style={{ color: colors.muted, marginTop: 8 }}>
                        • {m}
                      </Text>
                    ))}
                    {status.kycLink ? (
                      <TouchableOpacity
                        onPress={() => Linking.openURL(status.kycLink as string)}
                        className="rounded-full px-4 py-2.5 mt-3 flex-row items-center justify-center self-start"
                        style={{ backgroundColor: 'rgba(107,91,149,0.12)' }}
                      >
                        <Text style={{ color: colors.brand, fontWeight: '700' }}>Complete verification</Text>
                        <Ionicons name="open-outline" size={16} color={colors.brand} style={{ marginLeft: 6 }} />
                      </TouchableOpacity>
                    ) : null}
                  </View>
                ) : null}
                {statusError ? <Text style={{ color: '#EF4444', marginTop: 8 }}>{statusError}</Text> : null}
              </View>
            </>
          ) : (
            <>
              <Text style={{ color: colors.muted, marginBottom: 16 }}>
                A USD account needs a few extra details for US banking compliance. This is separate
                from your Naira account.
              </Text>
              <View style={{ gap: 12 }}>
                <View>
                  <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '600', marginBottom: 4 }}>
                    Tax / ID number
                  </Text>
                  {input(idNumber, setIdNumber, 'Your tax identification number')}
                </View>
                <View>
                  <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '600', marginBottom: 6 }}>
                    Employment status
                  </Text>
                  {chipRow(EMPLOYMENT, employmentStatus, setEmploymentStatus)}
                </View>
                <View>
                  <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '600', marginBottom: 4 }}>
                    What do you do?
                  </Text>
                  {input(employmentDescription, setEmploymentDescription, 'e.g. Software engineering')}
                </View>
                <View>
                  <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '600', marginBottom: 4 }}>
                    Employer / business name
                  </Text>
                  {input(employerName, setEmployerName, 'e.g. Self / company name')}
                </View>
                <View>
                  <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '600', marginBottom: 6 }}>
                    US residency status
                  </Text>
                  {chipRow(RESIDENCY, residency, setResidency)}
                </View>
              </View>
              <TouchableOpacity
                onPress={submit}
                disabled={!canSubmit}
                className="rounded-full py-4 items-center mt-5"
                style={{ backgroundColor: colors.brand, opacity: canSubmit ? 1 : 0.4 }}
              >
                <Text className="text-white font-bold">{submitting ? 'Opening…' : 'Open USD account'}</Text>
              </TouchableOpacity>
            </>
          )}

          {error ? <Text style={{ color: '#EF4444', marginTop: 12 }}>{error}</Text> : null}
        </View>
      )}
    </View>
  );
}
