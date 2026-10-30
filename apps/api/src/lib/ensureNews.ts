import { prisma } from "@cheqpay/db";

/**
 * Create the news_items table, lazily and idempotently.
 *
 * Migrations are not applied on deploy here (see ensureEvents), so the physical
 * table behind the NewsItem model is created at boot. NEW table only, so it is
 * select-all-safe. Deduped on `url` (unique) by the news cron's upsert.
 */
let ensured: Promise<void> | null = null;

export function ensureNewsSchema(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS news_items (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          source text NOT NULL,
          title text NOT NULL,
          url text NOT NULL,
          summary text,
          published_at timestamptz NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      await prisma.$executeRawUnsafe(
        `CREATE UNIQUE INDEX IF NOT EXISTS news_items_url_key ON news_items(url)`,
      );
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS news_items_published_at_idx ON news_items(published_at)`,
      );
    })();
  }
  return ensured;
}
