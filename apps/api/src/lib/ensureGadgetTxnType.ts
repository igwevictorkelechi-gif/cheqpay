import { prisma } from "@cheqpay/db";

/**
 * Add GADGET_PURCHASE to the TransactionType enum.
 *
 * It ships in the schema, but migrations are not applied on deploy here (see
 * ensureCardTxnTypes), so the value is added lazily and idempotently before the
 * first gadget order records its ledger row.
 *
 * Postgres refuses to use an enum value in the same transaction that added it,
 * so this runs on its own — call it, then write — never inside the balance
 * transaction that records the purchase.
 */
let ensured: Promise<void> | null = null;

export function ensureGadgetTxnType(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      await prisma.$executeRawUnsafe(
        `ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'GADGET_PURCHASE'`,
      );
    })().catch((err) => {
      ensured = null; // allow retry on the next purchase
      throw err;
    });
  }
  return ensured;
}
