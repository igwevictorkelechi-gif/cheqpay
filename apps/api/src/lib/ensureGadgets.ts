import { prisma } from "@cheqpay/db";

/**
 * Create the gadget-store tables, lazily and idempotently.
 *
 * Migrations are not applied on deploy here (see ensureCards, ensureCardTxnTypes),
 * so the physical tables behind GadgetProduct and GadgetOrder are created on
 * first use. Both are NEW tables, so this is select-all-safe: no existing model
 * gains a column, so no unrelated query starts failing the moment this ships —
 * which is why it does not need to run at boot the way column-adds do.
 *
 * The GADGET_PURCHASE enum value is added separately (ensureGadgetTxnType),
 * because Postgres will not use an enum value in the same transaction that
 * added it.
 *
 * NOTE: gadget_products.specs is added with ALTER TABLE ... ADD COLUMN below,
 * for stores whose table predates that column. Because Prisma now selects
 * `specs` on EVERY gadget_products query, this helper is wired into
 * instrumentation.ts so the column exists before the first query — the same
 * select-all rule the column-adding helpers follow (see schemaBootstrap.test).
 */
let ensured: Promise<void> | null = null;

export function ensureGadgetSchema(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS gadget_products (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          name text NOT NULL,
          description text NOT NULL DEFAULT '',
          price_minor bigint NOT NULL,
          image_url text,
          category text NOT NULL DEFAULT '',
          specs jsonb,
          stock integer,
          active boolean NOT NULL DEFAULT true,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      // For stores whose gadget_products predates the specs column.
      await prisma.$executeRawUnsafe(
        `ALTER TABLE gadget_products ADD COLUMN IF NOT EXISTS specs jsonb`,
      );
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS gadget_products_active_idx ON gadget_products(active)`,
      );

      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS gadget_orders (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
          product_id uuid REFERENCES gadget_products(id) ON DELETE SET NULL,
          product_name text NOT NULL,
          quantity integer NOT NULL DEFAULT 1,
          unit_price_minor bigint NOT NULL,
          total_minor bigint NOT NULL,
          status text NOT NULL DEFAULT 'PAID',
          delivery_name text NOT NULL,
          delivery_phone text NOT NULL,
          delivery_address text NOT NULL,
          delivery_city text NOT NULL,
          delivery_state text NOT NULL,
          note text,
          transaction_id uuid,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS gadget_orders_user_id_idx ON gadget_orders(user_id)`,
      );
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS gadget_orders_status_idx ON gadget_orders(status)`,
      );
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS gadget_orders_created_at_idx ON gadget_orders(created_at)`,
      );
    })().catch((err) => {
      ensured = null; // allow retry on the next request
      throw err;
    });
  }
  return ensured;
}
