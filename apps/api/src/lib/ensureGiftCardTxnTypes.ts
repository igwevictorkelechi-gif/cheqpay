import { prisma } from "@cheqpay/db";

/**
 * Add GIFTCARD_SELL, GIFTCARD_BUY and REFERRAL_REWARD to the TransactionType enum.
 *
 * They ship in the schema, but migrations are not applied on deploy here (see
 * ensureGadgetTxnType), so the values are added lazily and idempotently before
 * the first gift-card ledger row. Postgres refuses to use an enum value in the
 * same transaction that added it, so call this first, never inside the money
 * transaction.
 */
let ensured: Promise<void> | null = null;

export function ensureGiftCardTxnTypes(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      await prisma.$executeRawUnsafe(`ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'GIFTCARD_SELL'`);
      await prisma.$executeRawUnsafe(`ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'GIFTCARD_BUY'`);
      await prisma.$executeRawUnsafe(`ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'REFERRAL_REWARD'`);
    })().catch((err) => {
      ensured = null;
      throw err;
    });
  }
  return ensured;
}
