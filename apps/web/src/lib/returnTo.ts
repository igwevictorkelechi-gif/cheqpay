// Where to go after signing in. A shared event link opened while signed out
// used to lose the event: the login page sent everyone to the home screen.

import { safeInternalPath } from "./safeUrl";

const KEY = "cheqpay.returnTo";

/** Remember the page (path + query) to come back to after sign-in. */
export function rememberReturnTo(pathWithQuery: string): void {
  const safe = safeInternalPath(pathWithQuery);
  if (!safe || /^\/(login|signup|verify-otp|welcome)(\/|\?|$)/.test(safe)) return;
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ to: safe, at: Date.now() }));
  } catch {
    /* storage unavailable: the user lands on home instead */
  }
}

/** The remembered page, once; null when none or older than 30 minutes. */
export function takeReturnTo(): string | null {
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
