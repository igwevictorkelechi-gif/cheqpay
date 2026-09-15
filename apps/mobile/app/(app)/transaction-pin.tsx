import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { colors } from '@/components/brand';
import { api, ApiError } from '@/services/api';
import {
  disableBiometricPay,
  enableBiometricPay,
  hasBiometricHardware,
  isBiometricPayEnabled,
  syncStoredPin,
} from '@/lib/transactionPin';

/**
 * Manage the transaction PIN and biometric approval.
 *
 * Distinct from App lock, which is the device PIN that decides whether the app
 * opens. The copy leans on that difference deliberately — confusing the two
 * leads people to believe payments are protected when they are not.
 */
export default function TransactionPinScreen() {
  const insets = useSafeAreaInsets();
  const [isSet, setIsSet] = useState<boolean | null>(null);
  const [currentPin, setCurrentPin] = useState('');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [bioAvailable, setBioAvailable] = useState(false);
  const [bioOn, setBioOn] = useState(false);
  const [bioPin, setBioPin] = useState('');
  const [bioError, setBioError] = useState<string | null>(null);
  const [bioBusy, setBioBusy] = useState(false);

  useEffect(() => {
    void api
      .getTransactionPinStatus()
      .then((s) => setIsSet(s.isSet))
      .catch(() => setIsSet(false));
    void hasBiometricHardware().then(setBioAvailable);
    void isBiometricPayEnabled().then(setBioOn);
  }, []);

  const creating = isSet === false;

  async function save() {
    setError(null);
    setSaved(false);
    if (pin !== confirmPin) {
      setError("Those PINs don't match.");
      return;
    }
    setBusy(true);
    try {
      if (creating) await api.setTransactionPin(pin);
      else await api.changeTransactionPin(currentPin, pin);
      // Keep any biometric copy in step, or it would keep submitting the old
      // PIN and burn attempts against the lockout.
      await syncStoredPin(pin);
      setSaved(true);
      setIsSet(true);
      setCurrentPin('');
      setPin('');
      setConfirmPin('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't save that PIN. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Turning biometrics on stores the PIN, so we verify it with the server
   * first. Storing an unverified PIN would let Face ID quietly submit a wrong
   * one and lock the account out without the user typing a digit.
   */
  async function toggleBiometrics(next: boolean) {
    setBioError(null);
    if (!next) {
      await disableBiometricPay();
      setBioOn(false);
      setBioPin('');
      return;
    }
    if (bioPin.length < 4) {
      setBioError('Enter your PIN to turn this on.');
      return;
    }
    setBioBusy(true);
    try {
      await api.verifyTransactionPin(bioPin);
      await enableBiometricPay(bioPin);
      setBioOn(true);
      setBioPin('');
    } catch (e) {
      setBioError(e instanceof ApiError ? e.message : "That PIN didn't work.");
    } finally {
      setBioBusy(false);
    }
  }

  const canSave =
    pin.length >= 4 && confirmPin.length >= 4 && (creating || currentPin.length >= 4) && !busy;

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface, paddingTop: insets.top }}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 48 }}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            backgroundColor: colors.card,
            alignItems: 'center',
            justifyContent: 'center',
          }}
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={20} color={colors.ink} />
        </TouchableOpacity>

        <Text style={{ color: colors.ink, fontSize: 30, fontWeight: '800', marginTop: 20 }}>
          Transaction PIN
        </Text>
        <Text style={{ color: colors.muted, fontSize: 14, lineHeight: 21, marginTop: 8 }}>
          You use this PIN to approve every payment — sending money, withdrawing,
          paying a bill or moving money on and off your card. It is separate from
          your App lock PIN, which only decides whether the app opens on this device.
        </Text>

        {isSet === null ? (
          <ActivityIndicator color={colors.muted} style={{ marginTop: 32 }} />
        ) : (
          <>
            {!creating && (
              <Field label="Current PIN" value={currentPin} onChange={(v) => { setCurrentPin(v); setError(null); setSaved(false); }} />
            )}
            <Field label={creating ? 'Choose a PIN' : 'New PIN'} value={pin} onChange={(v) => { setPin(v); setError(null); setSaved(false); }} />
            <Field label="Confirm PIN" value={confirmPin} onChange={(v) => { setConfirmPin(v); setError(null); setSaved(false); }} />

            <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 12 }}>
              4 to 6 digits. Avoid repeated digits, runs like 1234, and anything
              someone could guess from your birthday — five wrong tries locks
              payments for a while.
            </Text>

            {error && <Text style={{ color: '#F87171', fontSize: 13, marginTop: 12 }}>{error}</Text>}
            {saved && <Text style={{ color: '#34D399', fontSize: 13, marginTop: 12 }}>PIN saved.</Text>}

            <TouchableOpacity
              onPress={save}
              disabled={!canSave}
              style={{
                marginTop: 20,
                borderRadius: 999,
                paddingVertical: 16,
                alignItems: 'center',
                backgroundColor: colors.brandLight,
                opacity: canSave ? 1 : 0.5,
              }}
            >
              <Text style={{ color: colors.white, fontSize: 16, fontWeight: '800' }}>
                {busy ? 'Saving…' : creating ? 'Create PIN' : 'Change PIN'}
              </Text>
            </TouchableOpacity>

            {isSet && bioAvailable && (
              <View style={{ marginTop: 32, backgroundColor: colors.card, borderRadius: 20, padding: 18 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={{ color: colors.ink, fontSize: 16, fontWeight: '700', flex: 1 }}>
                    Approve with Face ID
                  </Text>
                  <Switch
                    value={bioOn}
                    onValueChange={(v) => void toggleBiometrics(v)}
                    disabled={bioBusy}
                  />
                </View>
                <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 8 }}>
                  Turning this on stores your PIN on this device, in the secure
                  keystore, so Face ID can submit it for you. It never leaves the
                  phone — but anyone who can pass this device’s Face ID or
                  fingerprint can approve payments. Turning it off deletes it.
                </Text>
                {!bioOn && (
                  <>
                    <Field label="Confirm your PIN to turn this on" value={bioPin} onChange={(v) => { setBioPin(v); setBioError(null); }} />
                    {bioBusy && <ActivityIndicator color={colors.muted} style={{ marginTop: 10 }} />}
                  </>
                )}
                {bioError && <Text style={{ color: '#F87171', fontSize: 13, marginTop: 10 }}>{bioError}</Text>}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <View style={{ marginTop: 16 }}>
      <Text style={{ color: colors.muted, fontSize: 13, fontWeight: '600', marginBottom: 6 }}>
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={(t) => onChange(t.replace(/\D/g, '').slice(0, 6))}
        keyboardType="number-pad"
        secureTextEntry
        placeholder="••••"
        placeholderTextColor={colors.muted}
        accessibilityLabel={label}
        style={{
          backgroundColor: colors.card,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 16,
          paddingVertical: 14,
          color: colors.ink,
          fontSize: 20,
          textAlign: 'center',
          letterSpacing: 6,
        }}
      />
    </View>
  );
}
