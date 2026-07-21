import { prisma } from "@cheqpay/db";
import { ApiError } from "./http";

/**
 * Admin-controlled feature switches (kill switches). Stored as one JSON blob
 * in platform_settings under "feature_flags". Server routes enforce these —
 * turning a feature off blocks it for every client immediately, no deploy needed.
 */
export const FEATURE_DEFS = [
  { key: "ngn_deposits", label: "Naira deposits", description: "Virtual accounts & bank-transfer funding" },
  { key: "ngn_withdrawals", label: "Naira withdrawals", description: "Bank payouts from the NGN wallet" },
  { key: "crypto_trading", label: "Crypto trading", description: "Buy, sell and convert (quotes + swaps)" },
  { key: "crypto_deposits", label: "Crypto deposits", description: "Receive screens & deposit addresses" },
  { key: "crypto_withdrawals", label: "Crypto withdrawals", description: "Sending crypto to external wallets" },
  { key: "bill_payments", label: "Bill payments", description: "Airtime, data, electricity and cable" },
  { key: "virtual_cards", label: "Virtual cards", description: "USD virtual cards (requires Maplerad keys)" },
] as const;

export type FeatureKey = (typeof FEATURE_DEFS)[number]["key"];

const FLAGS_KEY = "feature_flags";

/**
 * Features that default OFF because they cannot safely serve a real user yet.
 * Flip these in the admin dashboard when their blocker clears — no deploy needed.
 *
 * - bill_payments: OFF while MAPLERAD_SECRET_KEY is a SANDBOX key. Bills would
 *   "succeed" and debit the user without delivering any airtime/data/power.
 *   Turn ON for a supervised test window, then OFF again; leave it ON only once
 *   the LIVE key is in place.
 * - ngn_deposits: Maplerad hasn't enabled NGN collections on the business, so
 *   virtual-account creation fails for every bank.
 * - crypto_deposits / crypto_withdrawals: two blockers. Maplerad's address
 *   endpoint currently fails on their side (SQL error, ticket open), AND the
 *   CBN/SEC VASP registration + Google Play Financial Features Declaration are
 *   compliance prerequisites that switching providers does not waive.
 * - virtual_cards: card issuing is wired to Maplerad's real endpoints but their
 *   exact shapes are only sandbox-confirmed for USD/VIRTUAL, and issuing is
 *   asynchronous (reconciled by webhook). Leave OFF until a card has actually
 *   been created and finalized end-to-end in the sandbox.
 */
const DEFAULT_OFF: readonly FeatureKey[] = [
  "bill_payments",
  "ngn_deposits",
  "crypto_deposits",
  "crypto_withdrawals",
  "virtual_cards",
];

const DEFAULTS: Record<FeatureKey, boolean> = Object.fromEntries(
  FEATURE_DEFS.map((f) => [f.key, !DEFAULT_OFF.includes(f.key)])
) as Record<FeatureKey, boolean>;

/** Current flags: stored values merged over all-on defaults. */
export async function getFeatureFlags(): Promise<Record<FeatureKey, boolean>> {
  const row = await prisma.platformSetting.findUnique({ where: { key: FLAGS_KEY } });
  if (!row) return { ...DEFAULTS };
  let stored: Record<string, unknown> = {};
  try {
    stored = JSON.parse(row.value) as Record<string, unknown>;
  } catch {
    /* corrupted value — fall back to defaults */
  }
  const out = { ...DEFAULTS };
  for (const def of FEATURE_DEFS) {
    if (typeof stored[def.key] === "boolean") out[def.key] = stored[def.key] as boolean;
  }
  return out;
}

export async function setFeatureFlags(
  patch: Partial<Record<FeatureKey, boolean>>,
  updatedBy?: string
): Promise<Record<FeatureKey, boolean>> {
  const current = await getFeatureFlags();
  const next = { ...current, ...patch };
  await prisma.platformSetting.upsert({
    where: { key: FLAGS_KEY },
    update: { value: JSON.stringify(next), updatedBy },
    create: { key: FLAGS_KEY, value: JSON.stringify(next), updatedBy },
  });
  return next;
}

/** Throw a clean 503 when a feature is switched off. */
export async function assertFeatureEnabled(key: FeatureKey): Promise<void> {
  const flags = await getFeatureFlags();
  if (!flags[key]) {
    const def = FEATURE_DEFS.find((f) => f.key === key);
    throw new ApiError(
      503,
      `${def?.label ?? "This feature"} is temporarily unavailable. Please try again later.`,
      "feature_disabled"
    );
  }
}
