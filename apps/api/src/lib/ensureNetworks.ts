import { prisma } from "@cheqpay/db";

/**
 * Add the chains Maplerad supports to the Network enum, idempotently.
 *
 * Migrations are not applied on deploy in this project (see ensureUsdAsset,
 * ensureTransferEnums), so new enum values are added lazily before the first
 * typed write that names them. This is an ALTER TYPE, not an ADD COLUMN — it
 * cannot break existing queries the way a new column can, so it runs on first
 * use rather than at boot.
 */
const NETWORKS = ["SOLANA", "BASE", "POLYGON"] as const;

let ensured: Promise<void> | null = null;

export function ensureNetworks(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      for (const n of NETWORKS) {
        // Each in its own statement: ALTER TYPE ... ADD VALUE cannot run inside
        // a transaction block alongside its own use.
        await prisma.$executeRawUnsafe(
          `ALTER TYPE "Network" ADD VALUE IF NOT EXISTS '${n}'`
        );
      }
    })().catch((err) => {
      ensured = null; // allow retry on the next call
      throw err;
    });
  }
  return ensured;
}
