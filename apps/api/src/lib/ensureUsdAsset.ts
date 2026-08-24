import { prisma } from "@cheqpay/db";

/**
 * Add the USD value to the Asset enum. Ships in the schema, but migrations are
 * not applied on deploy here (see ensureTransfers, ensureCards), so it is added
 * lazily and idempotently before the first USD row is written.
 *
 * Postgres refuses to use an enum value in the same transaction that added it,
 * so this deliberately runs on its own — call it, then write — rather than
 * inside the wallet-creating transaction.
 */
let ensured: Promise<void> | null = null;

export function ensureUsdAsset(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      await prisma.$executeRawUnsafe(`ALTER TYPE "Asset" ADD VALUE IF NOT EXISTS 'USD'`);
    })().catch((err) => {
      ensured = null; // allow retry on the next USD request
      throw err;
    });
  }
  return ensured;
}
