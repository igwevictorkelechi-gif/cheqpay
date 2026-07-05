// Lightweight PIN-based app lock for the web PWA. The PIN is stored in
// localStorage — this is a convenience lock, not a cryptographic control.
const PIN_KEY = "cheqpay.applock.pin";

export function isAppLockEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return !!localStorage.getItem(PIN_KEY);
}

export function setPin(pin: string): void {
  localStorage.setItem(PIN_KEY, pin);
}

export function verifyPin(pin: string): boolean {
  return localStorage.getItem(PIN_KEY) === pin;
}

export function disableAppLock(): void {
  localStorage.removeItem(PIN_KEY);
}
