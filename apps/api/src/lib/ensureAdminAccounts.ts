import { prisma } from "@cheqpay/db";

// The sub admin accounts table (raw SQL, no Prisma model), in a module of its
// own so the boot-time schema step (instrumentation.ts) can run it without
// pulling in adminCreds and its node:crypto, which the Edge compile can't bundle.

let accountsReady: Promise<void> | null = null;
export function ensureAdminAccountsTable(): Promise<void> {
  if (!accountsReady) {
    accountsReady = (async () => {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS admin_accounts (
          email text PRIMARY KEY,
          password_hash text NOT NULL,
          must_change boolean NOT NULL DEFAULT true,
          created_by text,
          created_at timestamptz NOT NULL DEFAULT now(),
          password_changed_at timestamptz
        )`);
      // Sections granted by a Super Admin, and the sub admin's own authenticator:
      // otp_pending until confirmed, otp_secret once active, otp_last_counter so a
      // code can't be used twice.
      await prisma.$executeRawUnsafe(`
        ALTER TABLE admin_accounts
          ADD COLUMN IF NOT EXISTS sections text[] NOT NULL DEFAULT '{}',
          ADD COLUMN IF NOT EXISTS otp_pending text,
          ADD COLUMN IF NOT EXISTS otp_secret text,
          ADD COLUMN IF NOT EXISTS otp_last_counter bigint`);
    })().catch((err) => {
      accountsReady = null;
      throw err;
    });
  }
  return accountsReady;
}
