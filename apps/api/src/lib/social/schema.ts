// apps/api/src/lib/social/schema.ts
//
// Tables for the social media scheduler, created lazily and idempotently at
// boot (deploy runs `prisma generate`, not migrations). They are NEW tables that
// nothing else selects, and deliberately not Prisma models, so adding them can't
// break an existing query — the same approach as gift card trades.
//
// Platform tokens are secrets that can post as the company: they are stored
// encrypted (encryptPii) and never returned by any endpoint.

import { prisma } from "@cheqpay/db";

let ensured: Promise<void> | null = null;

export function ensureSocialSchema(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      const statements = [
        `CREATE TABLE IF NOT EXISTS social_accounts (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          platform text NOT NULL,
          external_id text NOT NULL,
          name text NOT NULL,
          username text,
          avatar_url text,
          access_token_enc text NOT NULL,
          refresh_token_enc text,
          token_expires_at timestamptz,
          refresh_expires_at timestamptz,
          meta jsonb NOT NULL DEFAULT '{}'::jsonb,
          status text NOT NULL DEFAULT 'active',
          last_error text,
          connected_by text NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )`,
        `CREATE UNIQUE INDEX IF NOT EXISTS social_accounts_platform_ext_key ON social_accounts(platform, external_id)`,
        `CREATE TABLE IF NOT EXISTS social_oauth_states (
          state text PRIMARY KEY,
          platform text NOT NULL,
          code_verifier text,
          actor text NOT NULL,
          return_url text NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          expires_at timestamptz NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS social_media (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          storage_path text NOT NULL,
          kind text NOT NULL,
          mime text NOT NULL,
          size_bytes bigint NOT NULL,
          width int,
          height int,
          status text NOT NULL DEFAULT 'pending',
          uploaded_by text NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        )`,
        `CREATE TABLE IF NOT EXISTS social_posts (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          caption text NOT NULL DEFAULT '',
          overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
          media_ids uuid[] NOT NULL DEFAULT '{}',
          status text NOT NULL DEFAULT 'draft',
          scheduled_at timestamptz,
          review_note text,
          created_by text NOT NULL,
          submitted_at timestamptz,
          approved_by text,
          approved_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )`,
        `CREATE INDEX IF NOT EXISTS social_posts_status_sched_idx ON social_posts(status, scheduled_at)`,
        `CREATE TABLE IF NOT EXISTS social_post_targets (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          post_id uuid NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
          account_id uuid NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,
          status text NOT NULL DEFAULT 'queued',
          stage jsonb NOT NULL DEFAULT '{}'::jsonb,
          attempts int NOT NULL DEFAULT 0,
          next_attempt_at timestamptz,
          locked_until timestamptz,
          external_id text,
          external_url text,
          error text,
          published_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )`,
        `CREATE UNIQUE INDEX IF NOT EXISTS social_post_targets_post_account_key ON social_post_targets(post_id, account_id)`,
        `CREATE INDEX IF NOT EXISTS social_post_targets_status_idx ON social_post_targets(status, next_attempt_at)`,
      ];
      for (const sql of statements) await prisma.$executeRawUnsafe(sql);
    })().catch((err) => {
      ensured = null; // let the next call try again
      throw err;
    });
  }
  return ensured;
}
