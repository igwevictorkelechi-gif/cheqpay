import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';

const PIN_KEY = 'cheqpay.applock.pin';
const BIO_KEY = 'cheqpay.applock.biometric';

/** True when the user has set an app-lock PIN. */
export async function isAppLockEnabled(): Promise<boolean> {
  try {
    return !!(await SecureStore.getItemAsync(PIN_KEY));
  } catch {
    return false;
  }
}

export async function setPin(pin: string): Promise<void> {
  await SecureStore.setItemAsync(PIN_KEY, pin);
}

export async function verifyPin(pin: string): Promise<boolean> {
  try {
    const stored = await SecureStore.getItemAsync(PIN_KEY);
    return !!stored && stored === pin;
  } catch {
    return false;
  }
}

export async function disableAppLock(): Promise<void> {
  await SecureStore.deleteItemAsync(PIN_KEY);
  await SecureStore.deleteItemAsync(BIO_KEY);
}

export async function isBiometricEnabled(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(BIO_KEY)) === '1';
  } catch {
    return false;
  }
}

export async function setBiometricEnabled(on: boolean): Promise<void> {
  await SecureStore.setItemAsync(BIO_KEY, on ? '1' : '0');
}

/** Whether the device has enrolled biometrics (Face ID / fingerprint). */
export async function hasBiometricHardware(): Promise<boolean> {
  try {
    return (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync());
  } catch {
    return false;
  }
}

/** Prompt the OS biometric check. Returns true on success. */
export async function authenticateBiometric(): Promise<boolean> {
  try {
    const res = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Unlock CheqPay',
      fallbackLabel: 'Use PIN',
    });
    return res.success;
  } catch {
    return false;
  }
}
