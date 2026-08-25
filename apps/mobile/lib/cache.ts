import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Tiny AsyncStorage JSON cache so screens can paint last-known data instantly
 * instead of opening on a spinner. Mirrors the web app's lib/cache.ts.
 *
 * Every key is namespaced `cheqpay:` so `clearUserCaches` can find all of them
 * on sign-out without knowing what each screen stored.
 */
const PREFIX = 'cheqpay:';

export async function readCache<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function writeCache<T>(key: string, value: T): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or unavailable — a cache miss is not an error */
  }
}

/**
 * Drop every cached snapshot belonging to the signed-in user.
 *
 * Called on sign-out. These caches exist to paint a screen before the network
 * answers, which on a shared device means the next person to open the app would
 * otherwise see the previous user's balance — or, worse, their deposit address,
 * which someone could then pay into believing it was their own.
 */
export async function clearUserCaches(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const mine = keys.filter((k) => k.startsWith(PREFIX));
    if (mine.length > 0) await AsyncStorage.multiRemove(mine);
  } catch {
    /* ignore */
  }
}
