/**
 * What an API key may do.
 *
 * Every /v1 route declares exactly one scope, and a key carries the scopes its
 * owner chose when creating it. A key used only to pay bills from a backend job
 * therefore cannot read customer records or reveal card numbers, so a leak of
 * that key is a leak of that one capability, not of the whole account.
 *
 * `cards:details` (full card number and CVV) is the one sensitive scope. It is
 * never granted by default, and the API refuses a live key that holds it
 * without an IP allowlist.
 */
export const SCOPES = [
  { id: "account:read", label: "Account", description: "Read your plan, limits and usage." },
  { id: "wallets:read", label: "Wallets", description: "Read wallet balances and statements." },
  { id: "transactions:read", label: "Transactions", description: "Read transactions of every kind." },
  { id: "customers:read", label: "Customers (read)", description: "Read your customers and their KYC status." },
  { id: "customers:write", label: "Customers (write)", description: "Create customers and submit their KYC." },
  { id: "files:write", label: "Files", description: "Upload identity documents for KYC." },
  { id: "virtual_accounts:read", label: "Virtual accounts (read)", description: "Read virtual accounts." },
  { id: "virtual_accounts:write", label: "Virtual accounts (write)", description: "Create virtual accounts for verified customers." },
  { id: "transfers:write", label: "Transfers", description: "Move money between your own wallets." },
  { id: "fx:write", label: "Conversions", description: "Quote and convert between NGN and USD wallets." },
  { id: "bills:read", label: "Bills (read)", description: "Read the bill catalogue and bill payments." },
  { id: "bills:write", label: "Bills (write)", description: "Validate customers and pay bills." },
  { id: "cards:read", label: "Cards (read)", description: "Read cards and their transactions (masked)." },
  { id: "cards:write", label: "Cards (write)", description: "Issue, fund, withdraw from, freeze and unfreeze cards." },
  {
    id: "cards:details",
    label: "Card details",
    description: "Reveal a card's full number and CVV. Live keys with this scope must have an IP allowlist.",
    sensitive: true,
  },
  { id: "events:read", label: "Events", description: "Read the event log (the polling fallback for webhooks)." },
] as const;

export type Scope = (typeof SCOPES)[number]["id"];

export const SCOPE_IDS: readonly Scope[] = SCOPES.map((s) => s.id);

/** Scopes that are never granted unless asked for by name. */
export const SENSITIVE_SCOPES: readonly Scope[] = SCOPES.filter((s) => "sensitive" in s && s.sensitive).map((s) => s.id);

/** What a new key gets when its owner doesn't pick: everything except the sensitive scopes. */
export const DEFAULT_SCOPES: readonly Scope[] = SCOPE_IDS.filter((s) => !SENSITIVE_SCOPES.includes(s));

export function isScope(value: unknown): value is Scope {
  return typeof value === "string" && (SCOPE_IDS as readonly string[]).includes(value);
}
