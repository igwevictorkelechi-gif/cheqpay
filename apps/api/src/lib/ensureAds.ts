import { prisma } from "@cheqpay/db";

/**
 * Create the CheqPay Ads tables, lazily and idempotently (campaigns, slots,
 * stats, venues, screens, uptime, payouts). They are raw-SQL tables, not
 * Prisma models, so nothing selects them by default — but this helper also
 * adds ad_campaigns.promoted_venue_id with ALTER TABLE ... ADD COLUMN for
 * databases created before venues shipped, so it is wired into
 * instrumentation.ts per the column-add rule (see schemaBootstrap.test).
 * Kept free of node:crypto so it is safe in the boot graph.
 */
let ensured: Promise<void> | null = null;
export function ensureAdsSchema(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      const stmts = [
        `CREATE TABLE IF NOT EXISTS ad_campaigns (
          id uuid PRIMARY KEY,
          user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
          business_name text NOT NULL,
          headline text NOT NULL,
          body text NOT NULL DEFAULT '',
          image text NOT NULL,
          link_url text,
          cta text NOT NULL DEFAULT 'Learn more',
          category text NOT NULL,
          targeting jsonb NOT NULL DEFAULT '{}',
          start_day date NOT NULL,
          days integer NOT NULL CHECK (days > 0),
          status text NOT NULL DEFAULT 'PENDING_REVIEW'
            CHECK (status IN ('PENDING_REVIEW', 'APPROVED', 'LIVE', 'ENDED', 'REJECTED', 'CANCELLED')),
          reason text,
          reviewed_by text,
          reviewed_at timestamptz,
          paid_minor bigint NOT NULL,
          refunded_minor bigint NOT NULL DEFAULT 0,
          breakdown jsonb NOT NULL DEFAULT '[]',
          idempotency_key text NOT NULL UNIQUE,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )`,
        `CREATE INDEX IF NOT EXISTS ad_campaigns_user_idx ON ad_campaigns (user_id, created_at DESC)`,
        `CREATE INDEX IF NOT EXISTS ad_campaigns_status_idx ON ad_campaigns (status, start_day)`,
        `CREATE TABLE IF NOT EXISTS ad_campaign_slots (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          campaign_id uuid NOT NULL REFERENCES ad_campaigns(id) ON DELETE CASCADE,
          channel text NOT NULL,
          day date NOT NULL,
          price_minor bigint NOT NULL,
          status text NOT NULL DEFAULT 'BOOKED' CHECK (status IN ('BOOKED', 'DELIVERED', 'REFUNDED')),
          UNIQUE (campaign_id, channel, day)
        )`,
        `CREATE INDEX IF NOT EXISTS ad_slots_channel_day_idx ON ad_campaign_slots (channel, day, status)`,
        `CREATE TABLE IF NOT EXISTS ad_stats (
          campaign_id uuid NOT NULL REFERENCES ad_campaigns(id) ON DELETE CASCADE,
          channel text NOT NULL,
          day date NOT NULL,
          views integer NOT NULL DEFAULT 0,
          clicks integer NOT NULL DEFAULT 0,
          PRIMARY KEY (campaign_id, channel, day)
        )`,
        `CREATE TABLE IF NOT EXISTS ad_user_views (
          campaign_id uuid NOT NULL REFERENCES ad_campaigns(id) ON DELETE CASCADE,
          user_id uuid NOT NULL,
          day date NOT NULL,
          n integer NOT NULL DEFAULT 0,
          PRIMARY KEY (campaign_id, user_id, day)
        )`,
        `CREATE TABLE IF NOT EXISTS user_ad_segments (
          user_id uuid PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
          segments text[] NOT NULL DEFAULT '{}',
          updated_at timestamptz NOT NULL DEFAULT now()
        )`,
        `CREATE TABLE IF NOT EXISTS user_ad_prefs (
          user_id uuid PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
          personalised boolean NOT NULL DEFAULT true,
          muted_categories text[] NOT NULL DEFAULT '{}',
          updated_at timestamptz NOT NULL DEFAULT now()
        )`,
        `CREATE TABLE IF NOT EXISTS ad_venues (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          name text NOT NULL,
          category text NOT NULL DEFAULT 'other',
          description text NOT NULL DEFAULT '',
          photo text,
          address text NOT NULL DEFAULT '',
          city text NOT NULL DEFAULT '',
          state text NOT NULL DEFAULT '',
          lat double precision,
          lng double precision,
          opens text,
          closes text,
          owner_user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
          price_per_day_minor bigint NOT NULL DEFAULT 0,
          share_bps integer NOT NULL DEFAULT 5000 CHECK (share_bps >= 0 AND share_bps <= 10000),
          max_ads integer NOT NULL DEFAULT 8,
          listed boolean NOT NULL DEFAULT true,
          active boolean NOT NULL DEFAULT true,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )`,
        `CREATE TABLE IF NOT EXISTS ad_screens (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          venue_id uuid REFERENCES ad_venues(id) ON DELETE SET NULL,
          label text NOT NULL DEFAULT '',
          pair_code text UNIQUE,
          pair_expires timestamptz,
          token_hash text NOT NULL UNIQUE,
          paired_at timestamptz,
          last_seen_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT now()
        )`,
        `CREATE TABLE IF NOT EXISTS ad_screen_uptime (
          screen_id uuid NOT NULL REFERENCES ad_screens(id) ON DELETE CASCADE,
          day date NOT NULL,
          minutes integer NOT NULL DEFAULT 0,
          plays integer NOT NULL DEFAULT 0,
          last_beat timestamptz,
          PRIMARY KEY (screen_id, day)
        )`,
        `CREATE TABLE IF NOT EXISTS ad_venue_stats (
          venue_id uuid NOT NULL REFERENCES ad_venues(id) ON DELETE CASCADE,
          day date NOT NULL,
          views integer NOT NULL DEFAULT 0,
          taps integer NOT NULL DEFAULT 0,
          PRIMARY KEY (venue_id, day)
        )`,
        `CREATE TABLE IF NOT EXISTS ad_payouts (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          slot_id uuid NOT NULL UNIQUE REFERENCES ad_campaign_slots(id) ON DELETE CASCADE,
          venue_id uuid NOT NULL,
          owner_user_id uuid NOT NULL,
          amount_minor bigint NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        )`,
        `ALTER TABLE ad_campaigns ADD COLUMN IF NOT EXISTS promoted_venue_id uuid`,
        `CREATE TABLE IF NOT EXISTS user_ad_location (
          user_id uuid PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
          lat double precision NOT NULL,
          lng double precision NOT NULL,
          updated_at timestamptz NOT NULL DEFAULT now()
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
