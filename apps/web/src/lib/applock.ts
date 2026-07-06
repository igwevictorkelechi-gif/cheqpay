// PIN handling for the web PWA. Two distinct concepts live here:
//
//  1. The user's security PIN (set during onboarding). Having one does NOT lock
//     the app — it's just the PIN the user chose.
//  2. The opt-in App Lock, enabled only from Settings → App Lock, which requires
//     that PIN each time the app is (re)opened.
//
// These were previously conflated: onboarding wrote the app-lock PIN, which
// silently turned the whole-app lock on for every user. They're now separate,
// and App Lock only counts as enabled when an explicit flag is set — so a
// leftover PIN can never lock the app on its own.
//
// Storage is localStorage; this is a convenience lock, not a cryptographic
// control.

const PIN_KEY = "cheqpay.applock.pin";
const ENABLED_KEY = "cheqpay.applock.enabled";
const USER_PIN_KEY = "cheqpay.pin";

/** True only when the user has explicitly turned App Lock on (and set a PIN). */
export function isAppLockEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(ENABLED_KEY) === "1" && !!localStorage.getItem(PIN_KEY);
}

/** Turn App Lock on with the given PIN. */
export function enableAppLock(pin: string): void {
  localStorage.setItem(PIN_KEY, pin);
  localStorage.setItem(ENABLED_KEY, "1");
}

export function verifyPin(pin: string): boolean {
  return localStorage.getItem(PIN_KEY) === pin;
}

export function disableAppLock(): void {
  localStorage.removeItem(PIN_KEY);
  localStorage.removeItem(ENABLED_KEY);
}

/**
 * The user's security PIN chosen at onboarding. Stored separately from App Lock
 * so setting it never locks the app.
 */
export function setUserPin(pin: string): void {
  localStorage.setItem(USER_PIN_KEY, pin);
}

export function getUserPin(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(USER_PIN_KEY);
}

export function hasUserPin(): boolean {
  return !!getUserPin();
}
