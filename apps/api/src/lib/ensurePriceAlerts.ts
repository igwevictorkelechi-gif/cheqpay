import { prisma } from "@cheqpay/db";

/**
 * Create the price_alerts table, lazily and idempotently.
 *
 * Migrations are not applied on deploy here (see ensureEvents / ensureGadgets),
 * so the physical table behind the PriceAlert model is created at boot. It is a
 * NEW table — no existing model gains a column — so this is select-all-safe.
 *
 * `asset` is the existing Postgres "Asset" enum (created by the initial
 * migration), so no enum type is created here.
 */
let ensured: Promise<void> | null = null;

export function ensurePriceAlertsSchema(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS price_alerts (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
          asset "Asset" NOT NULL,
          direction text NOT NULL,
          target_usd numeric(20,8) NOT NULL,
          active boolean NOT NULL DEFAULT true,
          last_triggered_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS price_alerts_active_asset_idx ON price_alerts(active, asset)`,
      );
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS price_alerts_user_id_idx ON price_alerts(user_id)`,
      );
    })();
  }
  return ensured;
}
