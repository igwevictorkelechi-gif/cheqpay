// apps/api/src/lib/ajo/schema.ts
//
// Tables for Ajo, created lazily and idempotently (deploy runs `prisma
// generate`, not migrations). New tables that nothing else selects, and not
// Prisma models, so adding them cannot break an existing query.
//
//   ajo_plans          personal Ajo: a user saves a fixed amount on a schedule
//                      into a pot only they can take out
//   ajo_groups         group Ajo (rotating savings): members pay every round and
//                      one member collects the pot each round
//   ajo_members        who is in a group, and their collecting position
//   ajo_contributions  one row per member per round: paid, partly paid or missed
//   ajo_payouts        one row per round: who collected and how much so far
//
// Amounts are kobo in BIGINT columns, so they come back as JS bigints.

import { prisma } from "@cheqpay/db";

let ensured: Promise<void> | null = null;

export function ensureAjoSchema(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      // Enum values first and outside any transaction: Postgres refuses to use
      // an enum value in the transaction that added it.
      for (const v of ["AJO_SAVE", "AJO_RELEASE", "AJO_CONTRIBUTION", "AJO_PAYOUT"]) {
        await prisma.$executeRawUnsafe(`ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS '${v}'`);
      }
      const statements = [
        `CREATE TABLE IF NOT EXISTS ajo_plans (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
          name text NOT NULL,
          amount_minor bigint NOT NULL CHECK (amount_minor > 0),
          frequency text NOT NULL,
          total_count integer NOT NULL CHECK (total_count > 0),
          paid_count integer NOT NULL DEFAULT 0,
          missed_count integer NOT NULL DEFAULT 0,
          saved_minor bigint NOT NULL DEFAULT 0 CHECK (saved_minor >= 0),
          status text NOT NULL DEFAULT 'active',
          next_due_at timestamptz,
          closed_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )`,
        `CREATE INDEX IF NOT EXISTS ajo_plans_user_idx ON ajo_plans(user_id, created_at DESC)`,
        `CREATE INDEX IF NOT EXISTS ajo_plans_due_idx ON ajo_plans(status, next_due_at)`,
        `CREATE TABLE IF NOT EXISTS ajo_groups (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          owner_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
          name text NOT NULL,
          amount_minor bigint NOT NULL CHECK (amount_minor > 0),
          frequency text NOT NULL,
          size integer NOT NULL CHECK (size BETWEEN 2 AND 30),
          payout_order text NOT NULL DEFAULT 'join',
          invite_code text NOT NULL,
          status text NOT NULL DEFAULT 'forming',
          current_round integer NOT NULL DEFAULT 0,
          next_due_at timestamptz,
          started_at timestamptz,
          closed_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )`,
        `CREATE UNIQUE INDEX IF NOT EXISTS ajo_groups_invite_key ON ajo_groups(invite_code)`,
        `CREATE INDEX IF NOT EXISTS ajo_groups_due_idx ON ajo_groups(status, next_due_at)`,
        `CREATE TABLE IF NOT EXISTS ajo_members (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          group_id uuid NOT NULL REFERENCES ajo_groups(id) ON DELETE CASCADE,
          user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
          position integer,
          joined_at timestamptz NOT NULL DEFAULT now()
        )`,
        `CREATE UNIQUE INDEX IF NOT EXISTS ajo_members_group_user_key ON ajo_members(group_id, user_id)`,
        `CREATE UNIQUE INDEX IF NOT EXISTS ajo_members_group_position_key ON ajo_members(group_id, position) WHERE position IS NOT NULL`,
        `CREATE INDEX IF NOT EXISTS ajo_members_user_idx ON ajo_members(user_id)`,
        `CREATE TABLE IF NOT EXISTS ajo_contributions (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          group_id uuid NOT NULL REFERENCES ajo_groups(id) ON DELETE CASCADE,
          round integer NOT NULL,
          user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
          recipient_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
          amount_minor bigint NOT NULL CHECK (amount_minor > 0),
          paid_minor bigint NOT NULL DEFAULT 0 CHECK (paid_minor >= 0 AND paid_minor <= amount_minor),
          status text NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          paid_at timestamptz
        )`,
        `CREATE UNIQUE INDEX IF NOT EXISTS ajo_contributions_round_member_key ON ajo_contributions(group_id, round, user_id)`,
        `CREATE INDEX IF NOT EXISTS ajo_contributions_arrears_idx ON ajo_contributions(user_id) WHERE status <> 'paid'`,
        `CREATE TABLE IF NOT EXISTS ajo_payouts (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          group_id uuid NOT NULL REFERENCES ajo_groups(id) ON DELETE CASCADE,
          round integer NOT NULL,
          recipient_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
          amount_minor bigint NOT NULL DEFAULT 0,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )`,
        `CREATE UNIQUE INDEX IF NOT EXISTS ajo_payouts_round_key ON ajo_payouts(group_id, round)`,
      ];
      for (const sql of statements) await prisma.$executeRawUnsafe(sql);
    })().catch((err) => {
      ensured = null; // allow retry on the next call
      throw err;
    });
  }
  return ensured;
}
