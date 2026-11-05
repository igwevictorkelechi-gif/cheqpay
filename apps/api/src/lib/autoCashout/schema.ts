// apps/api/src/lib/autoCashout/schema.ts
//
// Tables for auto cash-out, created lazily and idempotently (deploy runs
// `prisma generate`, not migrations). New tables nothing else selects, and
// deliberately not Prisma models, so adding them can't break an existing query.
//
//   auto_cashout_settings — one row per user: on/off, which coins, which of the
//     user's saved (name-verified) bank accounts.
//   auto_cashouts — one row per deposit that was queued for cash-out. The
//     UNIQUE deposit_tx_id is what makes a deposit sell and pay out at most once,
//     however many webhook deliveries or job runs see it.

import { prisma } from "@cheqpay/db";
import { ensureBeneficiariesTable } from "../ensureBeneficiaries";

let ensured: Promise<void> | null = null;

export function ensureAutoCashoutSchema(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      await ensureBeneficiariesTable();
      const statements = [
        `CREATE TABLE IF NOT EXISTS auto_cashout_settings (
          user_id uuid PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
          enabled boolean NOT NULL DEFAULT false,
          assets text[] NOT NULL DEFAULT '{}',
          beneficiary_id uuid REFERENCES beneficiaries(id) ON DELETE SET NULL,
          updated_at timestamptz NOT NULL DEFAULT now()
        )`,
        `CREATE TABLE IF NOT EXISTS auto_cashouts (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
          deposit_tx_id uuid NOT NULL,
          asset text NOT NULL,
          coin text NOT NULL,
          amount_minor numeric(40,0) NOT NULL,
          beneficiary_id uuid,
          status text NOT NULL DEFAULT 'queued',
          reason text,
          swap_tx_id uuid,
          ngn_minor numeric(40,0),
          payout_tx_id uuid,
          payout_minor numeric(40,0),
          attempts integer NOT NULL DEFAULT 0,
          next_attempt_at timestamptz,
          locked_until timestamptz,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )`,
        `CREATE UNIQUE INDEX IF NOT EXISTS auto_cashouts_deposit_key ON auto_cashouts(deposit_tx_id)`,
        `CREATE INDEX IF NOT EXISTS auto_cashouts_user_idx ON auto_cashouts(user_id, created_at DESC)`,
        `CREATE INDEX IF NOT EXISTS auto_cashouts_due_idx ON auto_cashouts(status, next_attempt_at)`,
      ];
      for (const sql of statements) await prisma.$executeRawUnsafe(sql);
    })().catch((err) => {
      ensured = null; // allow retry on the next call
      throw err;
    });
  }
  return ensured;
}
