// apps/api/src/lib/ensureReferrals.ts
//
// The referral and creator-program tables (raw SQL, not Prisma models). Kept
// apart from referrals.ts so instrumentation.ts can boot it without pulling in
// alerts, email and push: it adds columns to influencer_applications, so it
// must run at boot (see schemaBootstrap.test.ts).

import { prisma } from "@cheqpay/db";

let ensured: Promise<void> | null = null;
export function ensureReferralSchema(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      const stmts = [
        `CREATE TABLE IF NOT EXISTS referral_codes (
          user_id uuid PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
          code text NOT NULL,
          kind text NOT NULL DEFAULT 'BASIC' CHECK (kind IN ('BASIC', 'INFLUENCER')),
          commission_bps integer NOT NULL DEFAULT 0 CHECK (commission_bps >= 0 AND commission_bps <= 10000),
          window_days integer,
          active boolean NOT NULL DEFAULT true,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )`,
        `CREATE UNIQUE INDEX IF NOT EXISTS referral_codes_code_idx ON referral_codes (lower(code))`,
        `CREATE TABLE IF NOT EXISTS referrals (
          referred_user_id uuid PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
          referrer_user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
          code text NOT NULL,
          status text NOT NULL DEFAULT 'SIGNED_UP' CHECK (status IN ('SIGNED_UP', 'QUALIFIED')),
          created_at timestamptz NOT NULL DEFAULT now(),
          qualified_at timestamptz
        )`,
        `CREATE INDEX IF NOT EXISTS referrals_referrer_idx ON referrals (referrer_user_id, created_at)`,
        `CREATE TABLE IF NOT EXISTS referral_earnings (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          earner_user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
          kind text NOT NULL CHECK (kind IN ('COMMISSION', 'BASIC_BONUS', 'WELCOME_BONUS', 'TASK')),
          source_key text NOT NULL UNIQUE,
          referred_user_id uuid,
          source_txn_id uuid,
          amount_minor bigint NOT NULL CHECK (amount_minor > 0),
          status text NOT NULL DEFAULT 'HELD' CHECK (status IN ('HELD', 'PAID', 'VOID')),
          note text,
          release_at timestamptz NOT NULL,
          paid_at timestamptz,
          void_reason text,
          transaction_id uuid,
          created_at timestamptz NOT NULL DEFAULT now()
        )`,
        `CREATE INDEX IF NOT EXISTS referral_earnings_earner_idx ON referral_earnings (earner_user_id, created_at DESC)`,
        `CREATE INDEX IF NOT EXISTS referral_earnings_release_idx ON referral_earnings (status, release_at)`,
        `CREATE TABLE IF NOT EXISTS influencer_tasks (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          title text NOT NULL,
          description text NOT NULL DEFAULT '',
          kind text NOT NULL CHECK (kind IN ('AUTO', 'PROOF')),
          metric text CHECK (metric IN ('signups', 'qualified', 'volume_ngn', 'first_deposits')),
          target bigint,
          reward_minor bigint NOT NULL CHECK (reward_minor > 0),
          starts_at timestamptz NOT NULL DEFAULT now(),
          ends_at timestamptz,
          assigned uuid[] NOT NULL DEFAULT '{}',
          active boolean NOT NULL DEFAULT true,
          created_by text,
          created_at timestamptz NOT NULL DEFAULT now()
        )`,
        `CREATE TABLE IF NOT EXISTS task_submissions (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          task_id uuid NOT NULL REFERENCES influencer_tasks(id) ON DELETE CASCADE,
          user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
          proof_url text,
          note text,
          status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
          reason text,
          reviewed_by text,
          reviewed_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT now(),
          UNIQUE (task_id, user_id)
        )`,
        `CREATE TABLE IF NOT EXISTS influencer_applications (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id uuid NOT NULL UNIQUE REFERENCES app_users(id) ON DELETE CASCADE,
          full_name text NOT NULL,
          phone text NOT NULL,
          socials jsonb NOT NULL DEFAULT '[]',
          niche text NOT NULL DEFAULT '',
          location text NOT NULL DEFAULT '',
          why text NOT NULL DEFAULT '',
          preferred_code text,
          status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
          reason text,
          reviewed_by text,
          reviewed_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )`,
        // The guided application (2026-10): more about the creator, KYC as it
        // stood when they applied, and a NEEDS_INFO round-trip with the admin.
        `ALTER TABLE influencer_applications
           ADD COLUMN IF NOT EXISTS bio text NOT NULL DEFAULT '',
           ADD COLUMN IF NOT EXISTS niches text[] NOT NULL DEFAULT '{}',
           ADD COLUMN IF NOT EXISTS audience_location text NOT NULL DEFAULT '',
           ADD COLUMN IF NOT EXISTS avg_views text,
           ADD COLUMN IF NOT EXISTS sample_links jsonb NOT NULL DEFAULT '[]',
           ADD COLUMN IF NOT EXISTS prior_brands text NOT NULL DEFAULT '',
           ADD COLUMN IF NOT EXISTS kyc_tier_at_apply integer,
           ADD COLUMN IF NOT EXISTS legal_name_at_apply text,
           ADD COLUMN IF NOT EXISTS terms_accepted_at timestamptz,
           ADD COLUMN IF NOT EXISTS request_note text,
           ADD COLUMN IF NOT EXISTS reapply_after timestamptz,
           ADD COLUMN IF NOT EXISTS submissions integer NOT NULL DEFAULT 1`,
        `DO $$ BEGIN
           IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'influencer_applications_status_check'
                       AND pg_get_constraintdef(oid) NOT LIKE '%NEEDS_INFO%') THEN
             ALTER TABLE influencer_applications DROP CONSTRAINT influencer_applications_status_check;
             ALTER TABLE influencer_applications ADD CONSTRAINT influencer_applications_status_check
               CHECK (status IN ('PENDING', 'NEEDS_INFO', 'APPROVED', 'REJECTED'));
           END IF;
         END $$`,
        `CREATE INDEX IF NOT EXISTS influencer_applications_status_idx ON influencer_applications (status, created_at)`,
        `CREATE TABLE IF NOT EXISTS referral_clicks (
          code_lower text NOT NULL,
          day date NOT NULL,
          clicks integer NOT NULL DEFAULT 0,
          PRIMARY KEY (code_lower, day)
        )`,
      ];
      for (const s of stmts) await prisma.$executeRawUnsafe(s);
    })().catch((err) => {
      ensured = null;
      throw err;
    });
  }
  return ensured;
}
