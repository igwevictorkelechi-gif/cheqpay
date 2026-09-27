// apps/api/src/lib/opsAlert.ts
//
// An ops alert that fires once per incident, not once per customer. When a
// provider path breaks, every customer who tries it fails the same way; ops
// needs to hear about it the first time, not fifty times.

import { notifyAdminAlert } from "./adminAlert";

const DEFAULT_THROTTLE_MS = 60 * 60 * 1000;
const lastSent = new Map<string, number>();

/** Send `text` to the ops webhook unless the same `key` alerted recently. Never throws. */
export async function alertOpsOnce(
  key: string,
  text: string,
  fields?: Record<string, string>,
  now: number = Date.now(),
  throttleMs: number = DEFAULT_THROTTLE_MS
): Promise<boolean> {
  const last = lastSent.get(key);
  if (last !== undefined && now - last < throttleMs) return false;
  lastSent.set(key, now);
  await notifyAdminAlert(text, fields).catch(() => undefined);
  return true;
}

export function resetOpsAlertThrottle(): void {
  lastSent.clear();
}
