import { prisma } from "@cheqpay/db";

/**
 * Create the event-ticketing tables, lazily and idempotently.
 *
 * Migrations are not applied on deploy here (see ensureGadgets), so the physical
 * tables behind Event, TicketTier, TicketOrder and Ticket are created on first
 * use. All are NEW tables, so this is select-all-safe: no existing model gains a
 * column, so no unrelated query starts failing the moment this ships.
 *
 * The TICKET_PURCHASE transaction-type value is added separately
 * (ensureTicketTxnType), because Postgres will not use an enum value in the same
 * transaction that added it.
 *
 * The TicketStatus enum type is created here (a DO block, so it is idempotent)
 * because the tickets.status column is that enum type and Prisma casts to it.
 */
let ensured: Promise<void> | null = null;

export function ensureEventsSchema(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      await prisma.$executeRawUnsafe(`
        DO $$ BEGIN
          CREATE TYPE "TicketStatus" AS ENUM ('VALID', 'USED', 'CANCELLED', 'REFUNDED');
        EXCEPTION WHEN duplicate_object THEN null;
        END $$;
      `);

      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS events (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          title text NOT NULL,
          description text NOT NULL DEFAULT '',
          venue text NOT NULL DEFAULT '',
          city text NOT NULL DEFAULT '',
          image_url text,
          starts_at timestamptz,
          active boolean NOT NULL DEFAULT true,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS events_active_idx ON events(active)`,
      );

      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS ticket_tiers (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
          name text NOT NULL,
          price_minor bigint NOT NULL,
          capacity integer,
          sold integer NOT NULL DEFAULT 0,
          active boolean NOT NULL DEFAULT true,
          sort_order integer NOT NULL DEFAULT 0,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS ticket_tiers_event_id_idx ON ticket_tiers(event_id)`,
      );

      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS ticket_orders (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
          event_id uuid NOT NULL,
          quantity integer NOT NULL DEFAULT 1,
          total_minor bigint NOT NULL,
          status text NOT NULL DEFAULT 'PAID',
          transaction_id uuid,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS ticket_orders_user_id_idx ON ticket_orders(user_id)`,
      );
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS ticket_orders_event_id_idx ON ticket_orders(event_id)`,
      );

      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS tickets (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          order_id uuid NOT NULL REFERENCES ticket_orders(id) ON DELETE CASCADE,
          user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
          event_id uuid NOT NULL,
          tier_id uuid,
          event_title text NOT NULL,
          tier_name text NOT NULL,
          price_minor bigint NOT NULL,
          reference text NOT NULL,
          status "TicketStatus" NOT NULL DEFAULT 'VALID',
          used_at timestamptz,
          checked_in_by text,
          created_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      await prisma.$executeRawUnsafe(
        `CREATE UNIQUE INDEX IF NOT EXISTS tickets_reference_key ON tickets(reference)`,
      );
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS tickets_user_id_idx ON tickets(user_id)`,
      );
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS tickets_event_id_idx ON tickets(event_id)`,
      );
    })().catch((err) => {
      ensured = null; // allow retry on the next request
      throw err;
    });
  }
  return ensured;
}
