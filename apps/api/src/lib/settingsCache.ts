// apps/api/src/lib/settingsCache.ts
//
// A few settings (feature flags, pricing) are read by most requests but change
// only when an admin saves them. Holding the last read for a few seconds turns
// thousands of identical database reads during a traffic spike into one per
// instance per window. A save on this instance clears it at once; other
// instances pick the change up within the window.

type Entry = { value: unknown; until: number };
const store = new Map<string, Entry>();

function ttlMs(): number {
  const raw = process.env.SETTINGS_CACHE_TTL_MS;
  if (raw !== undefined) return Math.max(0, Number(raw) || 0);
  // Off under test by default, so tests that change mocked rows per case see them.
  return process.env.NODE_ENV === "test" ? 0 : 15_000;
}

export async function cachedSetting<T>(key: string, load: () => Promise<T>): Promise<T> {
  const ttl = ttlMs();
  if (ttl === 0) return load();
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.until > now) return hit.value as T;
  const value = await load();
  store.set(key, { value, until: now + ttl });
  return value;
}

/** Forget a cached setting (after a save), or all of them. */
export function invalidateSetting(key?: string): void {
  if (key === undefined) store.clear();
  else store.delete(key);
}
