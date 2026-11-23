import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from './theme';
import { api, ApiError } from '../services/api';
import { isBiometricPayEnabled, pinViaBiometrics } from '../lib/transactionPin';

/**
 * The transaction PIN prompt — the mobile half of the server gate.
 *
 * Not to be confused with LockGate, the device PIN that decides whether the
 * app OPENS. This one decides whether money LEAVES, and lives on the server.
 *
 * Face ID first, keypad always. When biometric approval is on, the sheet tries
 * it immediately and submits the PIN it releases, so the common path is one
 * glance. Anything else — declined, not enrolled, cancelled — falls straight
 * through to the keypad rather than blocking the payment.
 *
 *   const { authorize } = useTransactionPin();
 *   await authorize((pin) => api.sendToUser(input, pin));
 */

type PinAction<T> = (pin: string) => Promise<T>;

export const PIN_CANCELLED = 'pin_cancelled';

interface PinContextValue {
  authorize<T>(action: PinAction<T>, opts?: PinOptions): Promise<T>;
}

const PinContext = createContext<PinContextValue | null>(null);

export function useTransactionPin(): PinContextValue {
  const ctx = useContext(PinContext);
  if (!ctx) throw new Error('useTransactionPin must be used inside <TransactionPinProvider>');
  return ctx;
}

function codeOf(err: unknown): string | null {
  if (err instanceof ApiError) {
    const body = (err as ApiError & { body?: { code?: string } }).body;
    return body?.code ?? null;
  }
  return null;
}

function messageOf(err: unknown, fallback: string): string {
  return err instanceof ApiError && err.message ? err.message : fallback;
}

/**
 * What the confirm sheet shows. `amount` and `rows` are the v2 Confirm layout
 * (the amount large, then "Fee", "Arrives", "Balance after"…, the last row
 * marked `total`). Optional: callers passing only title/detail keep working.
 */
export interface PinOptions {
  title?: string;
  detail?: string;
  amount?: string;
  rows?: { label: string; value: string; total?: boolean }[];
}

interface Pending extends PinOptions {
  action: PinAction<unknown>;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
}

export default function TransactionPinProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<'closed' | 'enter' | 'create'>('closed');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef<Pending | null>(null);

  const close = useCallback(() => {
    setMode('closed');
    setPin('');
    setConfirmPin('');
    setError(null);
    setBusy(false);
  }, []);

  const cancel = useCallback(() => {
    pending.current?.reject(new Error(PIN_CANCELLED));
    pending.current = null;
    close();
  }, [close]);

  /** Run the caller's action, translating the server's verdict on the PIN. */
  const run = useCallback(
    async (value: string): Promise<'ok' | 'retry' | 'create'> => {
      const p = pending.current;
      if (!p) return 'ok';
      setBusy(true);
      setError(null);
      try {
        const result = await p.action(value);
        pending.current = null;
        p.resolve(result);
        close();
        return 'ok';
      } catch (err) {
        const code = codeOf(err);
        if (code === 'pin_incorrect' || code === 'pin_required' || code === 'pin_locked') {
          // Nothing was charged — the server checks before its first write —
          // so stay open and let them try again.
          setError(messageOf(err, 'Incorrect PIN.'));
          setPin('');
          setBusy(false);
          return 'retry';
        }
        if (code === 'pin_not_set') {
          setMode('create');
          setPin('');
          setError(null);
          setBusy(false);
          return 'create';
        }
        // A real failure of the payment itself — the caller owns that.
        pending.current = null;
        p.reject(err);
        close();
        return 'ok';
      }
    },
    [close],
  );

  const authorize = useCallback<PinContextValue['authorize']>(
    (action, opts) =>
      new Promise((resolve, reject) => {
        pending.current = {
          action: action as PinAction<unknown>,
          resolve: resolve as (v: unknown) => void,
          reject,
          title: opts?.title,
          detail: opts?.detail,
          amount: opts?.amount,
          rows: opts?.rows,
        };
        setPin('');
        setConfirmPin('');
        setError(null);
        setBusy(false);
        setMode('enter');

        void (async () => {
          // Ask the server whether a PIN exists, so a first-timer is offered
          // set-up rather than a keypad for a PIN they never made.
          try {
            const s = await api.getTransactionPinStatus();
            if (!pending.current) return;
            if (!s.isSet) {
              setMode('create');
              return;
            }
          } catch {
            /* Status is an optimisation; the server still decides each attempt. */
          }
          // Face ID path. Submits on success; silently yields to the keypad
          // on anything else.
          if (!(await isBiometricPayEnabled())) return;
          if (!pending.current) return;
          const stored = await pinViaBiometrics(opts?.title ?? 'Approve this payment');
          if (stored && pending.current) await run(stored);
        })();
      }),
    [run],
  );

  const submitCreate = async () => {
    if (pin.length < 4 || pin !== confirmPin) {
      setError(pin !== confirmPin ? "Those PINs don't match." : null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.setTransactionPin(pin);
    } catch (err) {
      setError(messageOf(err, "That PIN can't be used. Please choose another."));
      setPin('');
      setConfirmPin('');
      setBusy(false);
      return;
    }
    await run(pin);
  };

  const creating = mode === 'create';
  const canSubmit = !busy && pin.length >= 4 && (!creating || confirmPin.length >= 4);

  return (
    <PinContext.Provider value={{ authorize }}>
      {children}
      <Modal visible={mode !== 'closed'} transparent animationType="slide" onRequestClose={cancel}>
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' }}>
          {/* v2 Confirm: a real sheet, lifted off the dimmed page. */}
          <View
            style={{
              backgroundColor: colors.card,
              borderTopLeftRadius: 28,
              borderTopRightRadius: 28,
              borderTopWidth: 1,
              borderColor: colors.cardTopEdge,
              padding: 24,
              paddingTop: 12,
              paddingBottom: 40,
            }}
          >
            <View style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.hairline, marginBottom: 14 }} />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <Text style={{ color: colors.ink, fontSize: 17, fontWeight: '700', flex: 1, paddingRight: 16 }}>
                {creating ? 'Create your transaction PIN' : (pending.current?.title ?? 'Enter your transaction PIN')}
              </Text>
              <Pressable onPress={cancel} disabled={busy} hitSlop={12} accessibilityLabel="Cancel">
                <Ionicons name="close" size={24} color={colors.muted} />
              </Pressable>
            </View>

            {!creating && pending.current?.amount ? (
              <Text
                style={{
                  color: colors.ink,
                  fontSize: 34,
                  lineHeight: 38,
                  fontWeight: '800',
                  letterSpacing: -0.7,
                  textAlign: 'center',
                  marginTop: 16,
                  fontVariant: ['tabular-nums'],
                }}
              >
                {pending.current.amount}
              </Text>
            ) : null}
            <Text
              style={{
                color: colors.muted,
                fontSize: 14,
                lineHeight: 20,
                marginTop: 6,
                textAlign: !creating && pending.current?.amount ? 'center' : 'left',
              }}
            >
              {creating
                ? "You'll use this PIN to approve every payment. Keep it to yourself — anyone who knows it can spend from your account."
                : (pending.current?.detail ?? 'This confirms the payment is really you.')}
            </Text>

            {!creating && pending.current?.rows?.length ? (
              <View style={{ marginTop: 18 }}>
                {pending.current.rows.map((r) => (
                  <View
                    key={r.label}
                    style={[
                      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', height: 28 },
                      r.total ? { borderTopWidth: 1, borderTopColor: colors.hairline, marginTop: 8, height: 40, paddingTop: 6 } : null,
                    ]}
                  >
                    <Text style={{ color: r.total ? colors.ink : colors.muted, fontSize: 15, fontWeight: r.total ? '700' : '400' }}>
                      {r.label}
                    </Text>
                    <Text style={{ color: colors.ink, fontSize: 15, fontWeight: r.total ? '700' : '600', fontVariant: ['tabular-nums'] }}>
                      {r.value}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}

            <PinField value={pin} onChange={(v) => { setPin(v); setError(null); }} autoFocus
              placeholder={creating ? 'New PIN' : 'PIN'} invalid={Boolean(error)} showLabel={creating} />
            {creating && (
              <PinField value={confirmPin} onChange={(v) => { setConfirmPin(v); setError(null); }}
                placeholder="Confirm PIN" invalid={Boolean(error)} showLabel />
            )}

            {error && (
              <Text style={{ color: '#F87171', fontSize: 13, textAlign: 'center', marginTop: 12 }}>
                {error}
              </Text>
            )}

            <Pressable
              onPress={creating ? submitCreate : () => run(pin)}
              disabled={!canSubmit}
              style={{
                marginTop: 24,
                borderRadius: 999,
                paddingVertical: 16,
                alignItems: 'center',
                flexDirection: 'row',
                justifyContent: 'center',
                gap: 8,
                backgroundColor: colors.brand,
                opacity: canSubmit ? 1 : 0.5,
              }}
            >
              {busy && <ActivityIndicator color={colors.white} size="small" />}
              <Text style={{ color: colors.white, fontSize: 16, fontWeight: '800' }}>
                {busy ? 'Confirming…' : creating ? 'Create PIN & continue' : 'Confirm payment'}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </PinContext.Provider>
  );
}

/**
 * v2 PinDots: six dots that fill as digits go in, over a real TextInput kept
 * invisible — so the number pad, secure entry and accessibility all come from
 * the platform. Tapping the dots focuses it.
 */
function PinField({
  value,
  onChange,
  placeholder,
  autoFocus,
  invalid,
  showLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  autoFocus?: boolean;
  invalid?: boolean;
  showLabel?: boolean;
}) {
  const input = useRef<TextInput>(null);
  return (
    <Pressable onPress={() => input.current?.focus()} style={{ marginTop: 20, alignItems: 'center' }} accessible={false}>
      {showLabel ? (
        <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '700', letterSpacing: 0.66, textTransform: 'uppercase', marginBottom: 6 }}>
          {placeholder}
        </Text>
      ) : null}
      <View style={{ flexDirection: 'row', gap: 16, height: 40, alignItems: 'center' }}>
        {Array.from({ length: 6 }, (_, i) => (
          <View
            key={i}
            style={{
              width: 14,
              height: 14,
              borderRadius: 7,
              borderWidth: 2,
              borderColor: invalid ? '#EF4444' : i < value.length ? colors.ink : colors.border,
              backgroundColor: invalid ? 'rgba(239,68,68,0.4)' : i < value.length ? colors.ink : 'transparent',
            }}
          />
        ))}
      </View>
      <TextInput
        ref={input}
        autoFocus={autoFocus}
        value={value}
        onChangeText={(t) => onChange(t.replace(/\D/g, '').slice(0, 6))}
        keyboardType="number-pad"
        // secureTextEntry so a shoulder-surfer or a screen recording sees nothing.
        secureTextEntry
        accessibilityLabel={placeholder}
        caretHidden
        style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }}
      />
    </Pressable>
  );
}
