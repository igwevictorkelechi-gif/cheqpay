import { prisma } from "@cheqpay/db";

// Like ensureBeneficiaries, the cards table is created lazily by the API
// itself (idempotent DDL, memoized per runtime) so it works without the
// Supabase migration tooling. Can be removed once a proper migration is
// recorded.
let ensured: Promise<void> | null = null;

export function ensureCardsTable(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS cards (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
          provider text NOT NULL DEFAULT 'maplerad',
          provider_card_id text NOT NULL,
          currency text NOT NULL DEFAULT 'USD',
          brand text,
          masked_pan text,
          status text NOT NULL DEFAULT 'active',
          created_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS cards_user_id_idx ON cards(user_id)`
      );
    })().catch((err) => {
      ensured = null; // allow retry on the next request
      throw err;
    });
  }
  return ensured;
}
