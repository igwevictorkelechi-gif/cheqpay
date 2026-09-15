import { prisma } from "@cheqpay/db";

/**
 * Add the transaction-PIN columns to app_users.
 *
 * They ship in the schema, but migrations are not applied on deploy here (see
 * ensureCards, ensureCardTxnTypes, ensureUsdAsset), so they are added lazily
 * and idempotently before the first PIN is read or written.
 *
 * All four columns are nullable or defaulted, so this is safe to run against a
 * table that already holds rows: existing users simply have no PIN yet, which
 * is exactly the state the set-up flow expects.
 */
let ensured: Promise<void> | null = null;

export function ensureTransactionPinColumns(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      await prisma.$executeRawUnsafe(`
        ALTER TABLE app_users
          ADD COLUMN IF NOT EXISTS transaction_pin_hash text,
          ADD COLUMN IF NOT EXISTS transaction_pin_set_at timestamptz,
          ADD COLUMN IF NOT EXISTS transaction_pin_failures integer NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS transaction_pin_locked_until timestamptz
      `);
    })().catch((err) => {
      ensured = null; // allow retry on the next request
      throw err;
    });
  }
  return ensured;
}
