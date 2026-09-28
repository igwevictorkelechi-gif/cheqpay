// Where to go once a conversion is done, when another screen sent the person
// to convert (e.g. "convert naira to dollars to pay for your card"). Kept apart
// from returnTo, which is for after sign-in.

import { safeInternalPath } from "./safeUrl";

const KEY = "cheqpay.afterConvert";

export function rememberAfterConvert(path: string): void {
  const safe = safeInternalPath(path);
  if (!safe) return;
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ to: safe, at: Date.now() }));
  } catch {
    /* storage unavailable: the success page offers its usual buttons */
  }
}

/** The screen to return to, once; null when none or older than 30 minutes. */
export function takeAfterConvert(): string | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    if (!raw) return null;
    const { to, at } = JSON.parse(raw) as { to?: string; at?: number };
    if (typeof at !== "number" || Date.now() - at > 30 * 60_000) return null;
    return safeInternalPath(to);
  } catch {
    return null;
  }
}
