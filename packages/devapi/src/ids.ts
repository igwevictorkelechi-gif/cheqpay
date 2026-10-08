/**
 * Public object ids: a type prefix and the row's UUID without dashes, e.g.
 * `wal_3f0c9a8e5b7d4e21a6f1c2b3d4e5f607`.
 *
 * The prefix tells a developer (and a support agent) what an id is at a glance,
 * and lets the API refuse an id of the wrong kind before it reaches a query. The
 * UUID part is random, so ids can't be guessed or enumerated; ownership is still
 * checked on every lookup.
 */
export const ID_PREFIXES = {
  account: "acct",
  key: "key",
  wallet: "wal",
  transaction: "txn",
  customer: "cus",
  virtual_account: "va",
  card: "card",
  quote: "fxq",
  file: "file",
  event: "evt",
  webhook_endpoint: "we",
  delivery: "whd",
  request: "req",
} as const;

export type IdKind = keyof typeof ID_PREFIXES;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function toPublicId(kind: IdKind, uuid: string): string {
  if (!UUID.test(uuid)) throw new Error(`Not a UUID: ${uuid}`);
  return `${ID_PREFIXES[kind]}_${uuid.replace(/-/g, "").toLowerCase()}`;
}

/**
 * The UUID behind a public id, or null if `value` is not an id of this kind.
 * Callers treat null exactly like "not found", so a malformed id and someone
 * else's id are indistinguishable.
 */
export function fromPublicId(kind: IdKind, value: unknown): string | null {
  if (typeof value !== "string") return null;
  const prefix = `${ID_PREFIXES[kind]}_`;
  if (!value.startsWith(prefix)) return null;
  const hex = value.slice(prefix.length);
  if (!/^[0-9a-f]{32}$/.test(hex)) return null;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
