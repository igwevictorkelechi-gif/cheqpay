import { prisma } from "@cheqpay/db";

/**
 * Add DEV_WALLET_FUND and DEV_WALLET_WITHDRAW to the TransactionType enum.
 *
 * Same reason as ensureAdTxnTypes: migrations are not applied on deploy, so
 * the values are added lazily and idempotently before the first row that uses
 * them. Postgres refuses to use an enum value in the transaction that added
 * it, so call this first, never inside the money transaction.
 */
let ensured: Promise<void> | null = null;

export function ensureDevTxnTypes(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      for (const v of ["DEV_WALLET_FUND", "DEV_WALLET_WITHDRAW"]) {
        await prisma.$executeRawUnsafe(`ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS '${v}'`);
      }
    })().catch((err) => {
      ensured = null;
      throw err;
    });
  }
  return ensured;
}
