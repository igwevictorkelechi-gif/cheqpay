/** Tiny localStorage JSON cache so screens can paint last-known data instantly. */
export function readCache<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function writeCache<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota / disabled — ignore */
  }
}

/**
 * Drop every cached balance/transaction snapshot after a money movement
 * (swap, convert, withdrawal, bill) so the next screen refetches fresh data.
 */
export function invalidateMoneyCaches(): void {
  if (typeof window === "undefined") return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (
        k &&
        (k.startsWith("cheqpay:crypto:") ||
          k.startsWith("cheqpay:asset:") ||
          k === "cheqpay:cash" ||
          k === "cheqpay:txns" ||
          k === "cheqpay:home:txns")
      ) {
        keys.push(k);
      }
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}
