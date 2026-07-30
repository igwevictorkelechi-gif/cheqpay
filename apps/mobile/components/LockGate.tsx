import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  AppState,
  type AppStateStatus,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/components/brand';
import { supabase } from '@/services/supabase';
import {
  isAppLockEnabled,
  verifyPin,
  setPin as savePin,
  isBiometricEnabled,
  hasBiometricHardware,
  authenticateBiometric,
} from '@/lib/applock';

/**
 * Lock screen steps. "otp"/"newPin" make up the forgot-PIN recovery: the PIN
 * lives only in this device's keychain, so the only way to prove ownership is
 * a fresh one-time code to the account's email address.
 */
type Step = 'pin' | 'otp' | 'newPin';

/** Shared style for the recovery code / new-PIN fields. */
const otpInputStyle = {
  width: 200,
  textAlign: 'center' as const,
  fontSize: 28,
  letterSpacing: 10,
  color: colors.ink,
  backgroundColor: colors.card,
  borderRadius: 16,
  paddingVertical: 14,
  borderWidth: 1,
  borderColor: colors.border,
};

/**
 * Wraps the app and enforces the app-lock (PIN / Face ID) on cold start and
 * whenever the app returns to the foreground. Renders children underneath a
 * full-screen lock overlay while locked.
 */
export function LockGate({ children }: { children: ReactNode }) {
  const [locked, setLocked] = useState(false);
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);
  const appState = useRef(AppState.currentState);

  // Forgot-PIN recovery
  const [step, setStep] = useState<Step>('pin');
  const [email, setEmail] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const resetRecovery = () => {
    setStep('pin');
    setCode('');
    setNewPin('');
    setConfirmPin('');
    setMsg(null);
  };

  /** Email a one-time code to the address on the account. */
  const sendCode = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const { data } = await supabase.auth.getSession();
      const address = data.session?.user.email ?? null;
      if (!address) throw new Error('Your account has no email address.');
      setEmail(address);
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email: address,
        options: { shouldCreateUser: false },
      });
      if (otpError) throw otpError;
      setStep('otp');
      setMsg(`We sent a 6-digit code to ${address}.`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Couldn’t send the code. Try again.');
    } finally {
      setBusy(false);
    }
  };

  /** Verify the code, which proves ownership of the account email. */
  const verifyCode = async () => {
    if (!email) return;
    setBusy(true);
    setMsg(null);
    try {
      const { error: otpError } = await supabase.auth.verifyOtp({
        email,
        token: code,
        type: 'email',
      });
      if (otpError) throw otpError;
      setStep('newPin');
    } catch {
      setMsg('That code isn’t right or has expired. Request a new one.');
    } finally {
      setBusy(false);
    }
  };

  /** Replace the device PIN and let the user straight back in. */
  const saveNewPin = async () => {
    if (newPin.length < 4) return setMsg('Use at least 4 digits.');
    if (newPin !== confirmPin) return setMsg('PINs don’t match.');
    await savePin(newPin);
    setLocked(false);
    setPin('');
    resetRecovery();
  };

  const tryBiometric = async () => {
    if ((await isBiometricEnabled()) && (await hasBiometricHardware())) {
      if (await authenticateBiometric()) {
        setLocked(false);
        setPin('');
      }
    }
  };

  const lockIfEnabled = async () => {
    if (await isAppLockEnabled()) {
      setLocked(true);
      tryBiometric();
    }
  };

  useEffect(() => {
    lockIfEnabled();
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      const prev = appState.current;
      appState.current = next;
      // Re-lock when coming back to the foreground.
      if (prev.match(/inactive|background/) && next === 'active') {
        lockIfEnabled();
      }
    });
    return () => sub.remove();
  }, []);

  const submitPin = async (value: string) => {
    if (await verifyPin(value)) {
      setLocked(false);
      setPin('');
      setError(false);
    } else {
      setError(true);
      setPin('');
    }
  };

  return (
    <View style={{ flex: 1 }}>
      {children}
      {locked && (
        <View
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: 0,
            right: 0,
            backgroundColor: colors.surface,
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: 32,
          }}
        >
          <View
            style={{ width: 72, height: 72, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card }}
          >
            <Ionicons name="lock-closed" size={34} color={colors.brand} />
          </View>
          <Text
            style={{
              color: colors.ink,
              fontSize: 24,
              fontWeight: '800',
              marginTop: 20,
              textAlign: 'center',
            }}
          >
            {step === 'pin'
              ? 'CheqPay is locked'
              : step === 'otp'
                ? 'Check your email'
                : 'Set a new PIN'}
          </Text>
          <Text
            style={{
              color: colors.muted,
              fontSize: 14,
              marginTop: 8,
              marginBottom: 24,
              textAlign: 'center',
            }}
          >
            {step === 'pin'
              ? 'Enter your PIN to continue'
              : step === 'otp'
                ? `Enter the 6-digit code we sent to ${email ?? 'your email'}.`
                : 'Choose a new 4–6 digit PIN for this device.'}
          </Text>

          {step === 'pin' && (
            <>
              <TextInput
                value={pin}
                onChangeText={(t) => {
                  const v = t.replace(/\D/g, '').slice(0, 6);
                  setPin(v);
                  setError(false);
                  // Auto-submit at 6 digits; shorter PINs submit via the button.
                  if (v.length === 6) submitPin(v);
                }}
                keyboardType="number-pad"
                secureTextEntry
                autoFocus
                style={{
                  width: 200,
                  textAlign: 'center',
                  fontSize: 28,
                  letterSpacing: 12,
                  color: colors.ink,
                  backgroundColor: colors.card,
                  borderRadius: 16,
                  paddingVertical: 14,
                  borderWidth: 1,
                  borderColor: error ? '#EF4444' : colors.border,
                }}
              />
              {error && (
                <Text style={{ color: '#EF4444', marginTop: 10 }}>Wrong PIN. Try again.</Text>
              )}

              <TouchableOpacity
                onPress={() => submitPin(pin)}
                disabled={pin.length < 4}
                style={{
                  marginTop: 24,
                  backgroundColor: pin.length >= 4 ? colors.brand : colors.circle,
                  borderRadius: 999,
                  paddingVertical: 15,
                  paddingHorizontal: 48,
                }}
              >
                <Text style={{ color: '#FFFFFF', fontWeight: '700', fontSize: 16 }}>Unlock</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={sendCode}
                disabled={busy}
                style={{ marginTop: 20, flexDirection: 'row', alignItems: 'center' }}
              >
                {busy && <ActivityIndicator color={colors.brandLight} style={{ marginRight: 8 }} />}
                <Text style={{ color: colors.brandLight, fontWeight: '600' }}>
                  {busy ? 'Sending code…' : 'Forgot PIN?'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={tryBiometric}
                style={{ marginTop: 16, flexDirection: 'row', alignItems: 'center' }}
              >
                <Ionicons name="finger-print" size={20} color={colors.muted} />
                <Text style={{ color: colors.muted, marginLeft: 8 }}>Use Face ID / biometrics</Text>
              </TouchableOpacity>
            </>
          )}

          {step === 'otp' && (
            <>
              <TextInput
                value={code}
                onChangeText={(t) => {
                  setCode(t.replace(/\D/g, '').slice(0, 6));
                  setMsg(null);
                }}
                keyboardType="number-pad"
                autoFocus
                style={otpInputStyle}
              />
              <TouchableOpacity
                onPress={verifyCode}
                disabled={code.length < 6 || busy}
                style={{
                  marginTop: 24,
                  backgroundColor: code.length === 6 && !busy ? colors.brand : colors.circle,
                  borderRadius: 999,
                  paddingVertical: 15,
                  paddingHorizontal: 48,
                  flexDirection: 'row',
                  alignItems: 'center',
                }}
              >
                {busy && <ActivityIndicator color="#FFFFFF" style={{ marginRight: 8 }} />}
                <Text style={{ color: '#FFFFFF', fontWeight: '700', fontSize: 16 }}>
                  {busy ? 'Verifying…' : 'Verify'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={sendCode} disabled={busy} style={{ marginTop: 16 }}>
                <Text style={{ color: colors.brandLight, fontWeight: '600' }}>Send a new code</Text>
              </TouchableOpacity>
            </>
          )}

          {step === 'newPin' && (
            <>
              <TextInput
                value={newPin}
                onChangeText={(t) => {
                  setNewPin(t.replace(/\D/g, '').slice(0, 6));
                  setMsg(null);
                }}
                keyboardType="number-pad"
                secureTextEntry
                autoFocus
                style={otpInputStyle}
              />
              <TextInput
                value={confirmPin}
                onChangeText={(t) => {
                  setConfirmPin(t.replace(/\D/g, '').slice(0, 6));
                  setMsg(null);
                }}
                keyboardType="number-pad"
                secureTextEntry
                style={{ ...otpInputStyle, marginTop: 12 }}
              />
              <TouchableOpacity
                onPress={saveNewPin}
                disabled={newPin.length < 4 || confirmPin.length < 4}
                style={{
                  marginTop: 24,
                  backgroundColor:
                    newPin.length >= 4 && confirmPin.length >= 4 ? colors.brand : colors.circle,
                  borderRadius: 999,
                  paddingVertical: 15,
                  paddingHorizontal: 40,
                }}
              >
                <Text style={{ color: '#FFFFFF', fontWeight: '700', fontSize: 16 }}>
                  Save PIN & unlock
                </Text>
              </TouchableOpacity>
            </>
          )}

          {msg && (
            <Text
              style={{ color: colors.muted, marginTop: 14, textAlign: 'center', maxWidth: 300 }}
            >
              {msg}
            </Text>
          )}

          {step !== 'pin' && (
            <TouchableOpacity onPress={resetRecovery} style={{ marginTop: 18 }}>
              <Text style={{ color: colors.muted, fontWeight: '600' }}>Back to PIN</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}
