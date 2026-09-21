import { prisma } from "@cheqpay/db";

/**
 * Add the TICKET_PURCHASE value to the TransactionType enum, idempotently.
 *
 * Kept separate from ensureEventsSchema because Postgres will not let a newly
 * added enum value be used in the same transaction that added it.
 */
let ensured: Promise<void> | null = null;

export function ensureTicketTxnType(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      await prisma.$executeRawUnsafe(
        `ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'TICKET_PURCHASE'`,
      );
    })().catch((err) => {
      ensured = null;
      throw err;
    });
  }
  return ensured;
}
