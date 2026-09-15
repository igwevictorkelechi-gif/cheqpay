import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';

/**
 * Biometric approval for payments.
 *
 * How this actually works, because the honest description matters: the server
 * always verifies a real PIN. Face ID does not authorise anything by itself —
 * it unlocks a copy of the PIN held in this device's secure keystore, which is
 * then submitted exactly as if the user had typed it. That is how banking apps
 * do biometric payments, and it keeps one verification path on the server
 * rather than a second, weaker one that trusts a client's word.
 *
 * The consequence is a real trade-off, so it is opt-in and stated plainly in
 * the UI: turning this on stores your PIN on this device. expo-secure-store
 * puts it in the iOS keychain / Android keystore, so it is encrypted at rest
 * and does not leave the device — but it is a copy, and anyone who can pass
 * your device's biometric check can spend. Turning the setting off deletes it.
 */

const PIN_KEY = 'cheqpay.txn.pin';
const ENABLED_KEY = 'cheqpay.txn.bio';

/** Whether the device can do Face ID / fingerprint at all. */
export async function hasBiometricHardware(): Promise<boolean> {
  try {
    return (
      (await LocalAuthentication.hasHardwareAsync()) &&
      (await LocalAuthentication.isEnrolledAsync())
    );
  } catch {
    return false;
  }
}

/** Whether the user has turned on biometric approval for payments. */
export async function isBiometricPayEnabled(): Promise<boolean> {
  try {
    if ((await SecureStore.getItemAsync(ENABLED_KEY)) !== '1') return false;
    // The flag alone is not enough — without the stored PIN there is nothing
    // for a successful Face ID to release, and we would prompt for nothing.
    return Boolean(await SecureStore.getItemAsync(PIN_KEY));
  } catch {
    return false;
  }
}

/**
 * Turn biometric approval on, remembering `pin` for it.
 *
 * The caller must have just had this PIN accepted by the server, so we never
 * store one that does not work — a stored wrong PIN would lock the account out
 * through its own lockout ladder without the user ever typing a digit.
 */
export async function enableBiometricPay(pin: string): Promise<void> {
  await SecureStore.setItemAsync(PIN_KEY, pin);
  await SecureStore.setItemAsync(ENABLED_KEY, '1');
}

/** Turn it off and forget the PIN. */
export async function disableBiometricPay(): Promise<void> {
  await SecureStore.deleteItemAsync(PIN_KEY);
  await SecureStore.setItemAsync(ENABLED_KEY, '0');
}

/**
 * Ask for Face ID / fingerprint and, on success, return the stored PIN.
 *
 * Returns null on anything else — cancelled, failed, not enrolled — so the
 * caller falls back to asking the user to type it. Never throws: a biometric
 * hiccup must degrade to the keypad, not block the payment.
 */
export async function pinViaBiometrics(promptMessage = 'Approve this payment'): Promise<string | null> {
  try {
    if (!(await isBiometricPayEnabled())) return null;
    const res = await LocalAuthentication.authenticateAsync({
      promptMessage,
      fallbackLabel: 'Enter PIN',
      // Keep the OS sheet to biometrics; our own keypad is the fallback, and
      // the device passcode is not evidence of THIS account's PIN.
      disableDeviceFallback: true,
    });
    if (!res.success) return null;
    return await SecureStore.getItemAsync(PIN_KEY);
  } catch {
    return null;
  }
}

/**
 * Keep the stored PIN in step with a change made elsewhere. Called after a
 * successful PIN change so biometrics do not keep submitting the old one.
 */
export async function syncStoredPin(pin: string): Promise<void> {
  try {
    if ((await SecureStore.getItemAsync(ENABLED_KEY)) === '1') {
      await SecureStore.setItemAsync(PIN_KEY, pin);
    }
  } catch {
    /* Best effort — worst case the user re-enables it in Settings. */
  }
}
