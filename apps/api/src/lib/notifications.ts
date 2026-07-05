/**
 * Per-category notification opt-ins. Stored as JSON on the user row and
 * consulted before every push send. Keys are stable identifiers shared with
 * the web + mobile Notifications screens.
 */
export const NOTIFICATION_CATEGORIES = [
  "deposits",
  "withdrawals",
  "trades",
  "bills",
  "price",
  "security",
  "promos",
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export type NotificationPrefs = Record<NotificationCategory, boolean>;

/** Sensible defaults: money movement + security on, price/promos off. */
export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  deposits: true,
  withdrawals: true,
  trades: true,
  bills: true,
  price: false,
  security: true,
  promos: false,
};

/** Merge a stored (possibly partial / null) prefs blob over the defaults. */
export function resolvePrefs(stored: unknown): NotificationPrefs {
  const out: NotificationPrefs = { ...DEFAULT_NOTIFICATION_PREFS };
  if (stored && typeof stored === "object") {
    for (const key of NOTIFICATION_CATEGORIES) {
      const v = (stored as Record<string, unknown>)[key];
      if (typeof v === "boolean") out[key] = v;
    }
  }
  return out;
}
