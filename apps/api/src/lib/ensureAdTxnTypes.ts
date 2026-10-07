import { prisma } from "@cheqpay/db";

/**
 * Add AD_PURCHASE, AD_REFUND and AD_PAYOUT to the TransactionType enum.
 *
 * Same reason as ensureGiftCardTxnTypes: migrations are not applied on deploy,
 * so the values are added lazily and idempotently before the first ad ledger
 * row. Postgres refuses to use an enum value in the transaction that added it,
 * so call this first, never inside the money transaction.
 */
let ensured: Promise<void> | null = null;

export function ensureAdTxnTypes(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      for (const v of ["AD_PURCHASE", "AD_REFUND", "AD_PAYOUT"]) {
        await prisma.$executeRawUnsafe(`ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS '${v}'`);
      }
    })().catch((err) => {
      ensured = null;
      throw err;
    });
  }
  return ensured;
}
