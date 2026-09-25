// The opt-in App Lock for the web PWA: a device PIN asked for each time the app
// is (re)opened. Enabled only from Settings → App Lock.
//
// The PIN is never stored. What's kept is a salted PBKDF2 hash (WebCrypto,
// 150k iterations), so something that reads this browser's storage — an
// injected script, a shared computer — learns nothing it can type back in, and
// can't learn a PIN the user may reuse elsewhere.
//
// Guessing is slowed down and then stopped: after 5 wrong tries each further
// one waits longer, and at 10 the session is signed out.
//
// (An older build also stored an onboarding "security PIN" in plaintext under
// `cheqpay.pin`, which nothing read. It is deleted on load.)

const HASH_KEY = "cheqpay.applock.hash"; // "pbkdf2$<iter>$<salt b64>$<hash b64>"
const LEGACY_PIN_KEY = "cheqpay.applock.pin"; // plaintext, pre-hashing builds
const ENABLED_KEY = "cheqpay.applock.enabled";
const FAILS_KEY = "cheqpay.applock.fails";
const UNTIL_KEY = "cheqpay.applock.until";
const LEGACY_USER_PIN_KEY = "cheqpay.pin";

const ITERATIONS = 150_000;
export const BACKOFF_AFTER = 5;
export const SIGN_OUT_AFTER = 10;

function store(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

// Old builds kept this in plaintext and never used it — remove it everywhere.
store()?.removeItem(LEGACY_USER_PIN_KEY);

const b64 = (buf: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(buf instanceof Uint8Array ? buf : new Uint8Array(buf))));
const unb64 = (s: string): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(new ArrayBuffer(atob(s).length));
  const raw = atob(s);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
};

async function derive(pin: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, [
    "deriveBits",
  ]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
}

export async function hashAppLockPin(pin: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(16)));
  const bits = await derive(pin, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${b64(salt)}$${b64(bits)}`;
}

export async function checkAppLockPin(pin: string, stored: string): Promise<boolean> {
  const [scheme, iter, salt, hash] = stored.split("$");
  if (scheme !== "pbkdf2" || !iter || !salt || !hash) return false;
  const bits = b64(await derive(pin, unb64(salt), Number(iter)));
  // Constant-time compare of the two encodings.
  if (bits.length !== hash.length) return false;
  let diff = 0;
  for (let i = 0; i < bits.length; i++) diff |= bits.charCodeAt(i) ^ hash.charCodeAt(i);
  return diff === 0;
}

/** True only when the user has explicitly turned App Lock on (and set a PIN). */
export function isAppLockEnabled(): boolean {
  const s = store();
  if (!s) return false;
  return s.getItem(ENABLED_KEY) === "1" && !!(s.getItem(HASH_KEY) || s.getItem(LEGACY_PIN_KEY));
}

/** Turn App Lock on with the given PIN. */
export async function enableAppLock(pin: string): Promise<void> {
  const s = store();
  if (!s) return;
  s.setItem(HASH_KEY, await hashAppLockPin(pin));
  s.removeItem(LEGACY_PIN_KEY);
  s.setItem(ENABLED_KEY, "1");
  clearFailures();
}

export function disableAppLock(): void {
  const s = store();
  if (!s) return;
  for (const k of [HASH_KEY, LEGACY_PIN_KEY, ENABLED_KEY, FAILS_KEY, UNTIL_KEY]) s.removeItem(k);
}

/** Milliseconds until another try is allowed (0 = now). */
export function lockoutRemainingMs(): number {
  const until = Number(store()?.getItem(UNTIL_KEY) ?? 0);
  return Math.max(0, until - Date.now());
}

export function failureCount(): number {
  return Number(store()?.getItem(FAILS_KEY) ?? 0);
}

function clearFailures(): void {
  store()?.removeItem(FAILS_KEY);
  store()?.removeItem(UNTIL_KEY);
}

export type VerifyResult = "ok" | "wrong" | "wait" | "sign_out";

/**
 * Check a PIN. A pre-hashing plaintext PIN is upgraded to a hash the first
 * time it's entered correctly.
 */
export async function verifyAppLockPin(pin: string): Promise<VerifyResult> {
  const s = store();
  if (!s) return "wrong";
  if (lockoutRemainingMs() > 0) return "wait";

  const hash = s.getItem(HASH_KEY);
  const legacy = s.getItem(LEGACY_PIN_KEY);
  const ok = hash ? await checkAppLockPin(pin, hash) : legacy !== null && legacy === pin;
  if (ok) {
    if (!hash) await enableAppLock(pin); // migrate to the hashed form
    clearFailures();
    return "ok";
  }

  const fails = failureCount() + 1;
  s.setItem(FAILS_KEY, String(fails));
  if (fails >= SIGN_OUT_AFTER) return "sign_out";
  if (fails >= BACKOFF_AFTER) {
    // 30s, 60s, 2m, 4m, 8m …
    const wait = 30_000 * 2 ** (fails - BACKOFF_AFTER);
    s.setItem(UNTIL_KEY, String(Date.now() + wait));
  }
  return "wrong";
}
