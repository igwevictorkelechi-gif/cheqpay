import { prisma } from "@cheqpay/db";

// The Supabase migration tooling was unavailable when this feature shipped, so
// the table is created lazily by the API itself (idempotent DDL, memoized per
// runtime). Harmless once the table exists; can be removed after a proper
// migration is recorded.
let ensured: Promise<void> | null = null;

export function ensureBeneficiariesTable(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS beneficiaries (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
          bank_code text NOT NULL,
          bank_name text NOT NULL,
          account_number text NOT NULL,
          account_name text NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT beneficiaries_user_account_unique UNIQUE (user_id, bank_code, account_number)
        )
      `);
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS beneficiaries_user_id_idx ON beneficiaries(user_id)`
      );
    })().catch((err) => {
      ensured = null; // allow retry on the next request
      throw err;
    });
  }
  return ensured;
}
