import { prisma } from "@cheqpay/db";

// The TRANSFER_OUT/TRANSFER_IN enum values ship as migration 0010, but
// migrations are not applied on deploy in this project (see ensureCards,
// ensureBeneficiaries, ensureCashbackEnum), so they are also added lazily and
// idempotently before the first transfer is written.
let ensured: Promise<void> | null = null;

export function ensureTransferEnums(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      await prisma.$executeRawUnsafe(
        `ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'TRANSFER_OUT'`
      );
      await prisma.$executeRawUnsafe(
        `ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'TRANSFER_IN'`
      );
    })().catch((err) => {
      ensured = null; // allow retry on the next transfer
      throw err;
    });
  }
  return ensured;
}
