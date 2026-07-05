import { useEffect, useRef, useState, type ReactNode } from 'react';
import { View, Text, TextInput, TouchableOpacity, AppState, type AppStateStatus } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/components/brand';
import {
  isAppLockEnabled,
  verifyPin,
  isBiometricEnabled,
  hasBiometricHardware,
  authenticateBiometric,
} from '@/lib/applock';

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
          <Text style={{ color: colors.ink, fontSize: 24, fontWeight: '800', marginTop: 20 }}>
            CheqPay is locked
          </Text>
          <Text style={{ color: colors.muted, fontSize: 14, marginTop: 8, marginBottom: 24 }}>
            Enter your PIN to continue
          </Text>

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
          {error && <Text style={{ color: '#EF4444', marginTop: 10 }}>Wrong PIN. Try again.</Text>}

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

          <TouchableOpacity onPress={tryBiometric} style={{ marginTop: 20, flexDirection: 'row', alignItems: 'center' }}>
            <Ionicons name="finger-print" size={20} color={colors.muted} />
            <Text style={{ color: colors.muted, marginLeft: 8 }}>Use Face ID / biometrics</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}
