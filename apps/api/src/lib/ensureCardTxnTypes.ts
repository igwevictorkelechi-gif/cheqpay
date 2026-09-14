import { prisma } from "@cheqpay/db";

/**
 * Add the card-movement values to the TransactionType enum.
 *
 * They ship in the schema, but migrations are not applied on deploy here (see
 * ensureUsdAsset, ensureCards, ensureCashbackEnum), so the values are added
 * lazily and idempotently before the first card fund/withdraw is recorded.
 *
 * Postgres refuses to use an enum value in the same transaction that added it,
 * so this runs on its own — call it, then write — never inside the balance
 * transaction that records the movement.
 */
let ensured: Promise<void> | null = null;

export function ensureCardTxnTypes(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      await prisma.$executeRawUnsafe(
        `ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'CARD_FUND'`,
      );
      await prisma.$executeRawUnsafe(
        `ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'CARD_WITHDRAW'`,
      );
    })().catch((err) => {
      ensured = null; // allow retry on the next card movement
      throw err;
    });
  }
  return ensured;
}
