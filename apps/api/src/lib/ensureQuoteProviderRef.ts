import { prisma } from "@cheqpay/db";

/**
 * Add Quote.provider_ref, idempotently, at boot.
 *
 * Migrations are not applied on deploy in this project, so a new column on an
 * existing table must be created before the first query of that model — Prisma
 * selects every declared column on every Quote query, so the moment the schema
 * declares provider_ref, every quote read/write emits it. This runs from
 * instrumentation.ts (see schemaBootstrap.test.ts, which enforces that wiring).
 */
let ensured: Promise<void> | null = null;

export function ensureQuoteProviderRef(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "quotes" ADD COLUMN IF NOT EXISTS "provider_ref" TEXT`
      );
    })().catch((err) => {
      ensured = null; // allow retry on the next boot
      throw err;
    });
  }
  return ensured;
}
