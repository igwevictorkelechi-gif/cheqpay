import { prisma } from "@cheqpay/db";

/**
 * The developer platform's tables, created lazily and idempotently.
 *
 * Raw-SQL tables, not Prisma models, so nothing selects them by accident. Wired
 * into instrumentation.ts so they exist before the first request, and called
 * again (memoized) by every devapi entry point in case boot couldn't reach the
 * database. Kept free of node:crypto so it is safe in the boot graph.
 *
 * Money rules enforced by the database itself, not just by the code:
 *   - a wallet balance can never go below zero (CHECK);
 *   - ledger entries are append-only: a trigger refuses UPDATE, DELETE and
 *     TRUNCATE, so history can't be rewritten even by a buggy or hostile query;
 *   - each movement writes at most one entry per wallet and kind (UNIQUE), so a
 *     retried request can't apply the same movement twice.
 */
let ensured: Promise<void> | null = null;

export function ensureDevApiSchema(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      for (const sql of STATEMENTS) await prisma.$executeRawUnsafe(sql);
    })().catch((err) => {
      ensured = null;
      throw err;
    });
  }
  return ensured;
}

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS dev_accounts (
    id uuid PRIMARY KEY,
    owner_user_id uuid NOT NULL UNIQUE REFERENCES app_users(id) ON DELETE RESTRICT,
    business_name text NOT NULL,
    status text NOT NULL DEFAULT 'sandbox'
      CHECK (status IN ('sandbox', 'pending_review', 'approved', 'rejected', 'suspended')),
    status_before_suspension text,
    legal_name text,
    rc_number text,
    business_type text,
    website text,
    use_case text,
    expected_monthly_volume text,
    contact_phone text,
    address text,
    cac_file_id uuid,
    submitted_at timestamptz,
    review_note text,
    reviewed_by text,
    reviewed_at timestamptz,
    live_since timestamptz,
    daily_out_limit_ngn bigint,
    daily_out_limit_usd bigint,
    max_float_ngn bigint,
    max_float_usd bigint,
    require_ip_allowlist boolean NOT NULL DEFAULT false,
    frozen boolean NOT NULL DEFAULT false,
    frozen_reason text,
    frozen_by text CHECK (frozen_by IN ('owner', 'admin', 'system')),
    suspended_reason text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS dev_accounts_status_idx ON dev_accounts (status, submitted_at)`,

  `CREATE TABLE IF NOT EXISTS dev_api_keys (
    id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES dev_accounts(id) ON DELETE CASCADE,
    mode text NOT NULL CHECK (mode IN ('test', 'live')),
    label text NOT NULL,
    key_hash text NOT NULL UNIQUE,
    last4 text NOT NULL,
    scopes text[] NOT NULL,
    allowed_ips text[] NOT NULL DEFAULT '{}',
    expires_at timestamptz,
    revoked_at timestamptz,
    revoked_reason text,
    last_used_at timestamptz,
    last_used_ip text,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS dev_api_keys_account_idx ON dev_api_keys (account_id, mode, created_at DESC)`,

  `CREATE TABLE IF NOT EXISTS dev_audit_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id uuid NOT NULL REFERENCES dev_accounts(id) ON DELETE CASCADE,
    actor text NOT NULL,
    action text NOT NULL,
    target text,
    details jsonb NOT NULL DEFAULT '{}',
    ip text,
    user_agent text,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS dev_audit_logs_account_idx ON dev_audit_logs (account_id, created_at DESC)`,

  `CREATE TABLE IF NOT EXISTS dev_subscriptions (
    account_id uuid PRIMARY KEY REFERENCES dev_accounts(id) ON DELETE CASCADE,
    plan_id text NOT NULL,
    status text NOT NULL CHECK (status IN ('active', 'past_due', 'canceled')),
    current_period_start timestamptz NOT NULL,
    current_period_end timestamptz NOT NULL,
    cancel_at_period_end boolean NOT NULL DEFAULT false,
    next_plan_id text,
    past_due_since timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS dev_wallets (
    id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES dev_accounts(id) ON DELETE RESTRICT,
    mode text NOT NULL CHECK (mode IN ('test', 'live')),
    customer_id uuid,
    currency text NOT NULL CHECK (currency IN ('NGN', 'USD')),
    available_minor bigint NOT NULL DEFAULT 0 CHECK (available_minor >= 0),
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'frozen')),
    frozen_reason text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS dev_wallets_main_uidx ON dev_wallets (account_id, mode, currency) WHERE customer_id IS NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS dev_wallets_customer_uidx ON dev_wallets (customer_id, currency) WHERE customer_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS dev_wallets_account_idx ON dev_wallets (account_id, mode, created_at DESC)`,

  `CREATE TABLE IF NOT EXISTS dev_transactions (
    id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES dev_accounts(id) ON DELETE RESTRICT,
    mode text NOT NULL CHECK (mode IN ('test', 'live')),
    kind text NOT NULL,
    status text NOT NULL CHECK (status IN ('pending', 'successful', 'failed', 'reversed')),
    currency text NOT NULL CHECK (currency IN ('NGN', 'USD')),
    amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
    fee_minor bigint NOT NULL DEFAULT 0 CHECK (fee_minor >= 0),
    wallet_id uuid REFERENCES dev_wallets(id),
    counterparty_wallet_id uuid REFERENCES dev_wallets(id),
    customer_id uuid,
    reference text,
    description text,
    metadata jsonb NOT NULL DEFAULT '{}',
    details jsonb NOT NULL DEFAULT '{}',
    provider_ref text,
    app_ledger_tx_id uuid,
    failure_code text,
    failure_message text,
    initiator_ip text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz
  )`,
  `CREATE INDEX IF NOT EXISTS dev_transactions_account_idx ON dev_transactions (account_id, mode, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS dev_transactions_wallet_idx ON dev_transactions (wallet_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS dev_transactions_provider_idx ON dev_transactions (provider_ref) WHERE provider_ref IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS dev_transactions_reference_uidx ON dev_transactions (account_id, mode, reference) WHERE reference IS NOT NULL`,

  `CREATE TABLE IF NOT EXISTS dev_ledger_entries (
    id bigserial PRIMARY KEY,
    wallet_id uuid NOT NULL REFERENCES dev_wallets(id) ON DELETE RESTRICT,
    transaction_id uuid NOT NULL REFERENCES dev_transactions(id) ON DELETE RESTRICT,
    kind text NOT NULL,
    amount_minor bigint NOT NULL CHECK (amount_minor <> 0),
    balance_after bigint NOT NULL CHECK (balance_after >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (transaction_id, wallet_id, kind)
  )`,
  `CREATE INDEX IF NOT EXISTS dev_ledger_entries_wallet_idx ON dev_ledger_entries (wallet_id, id DESC)`,
  `CREATE OR REPLACE FUNCTION dev_ledger_entries_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
   BEGIN
     RAISE EXCEPTION 'dev_ledger_entries is append-only (% refused)', TG_OP;
   END $$`,
  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'dev_ledger_entries_no_rewrite') THEN
       CREATE TRIGGER dev_ledger_entries_no_rewrite BEFORE UPDATE OR DELETE ON dev_ledger_entries
         FOR EACH ROW EXECUTE FUNCTION dev_ledger_entries_append_only();
     END IF;
     IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'dev_ledger_entries_no_truncate') THEN
       CREATE TRIGGER dev_ledger_entries_no_truncate BEFORE TRUNCATE ON dev_ledger_entries
         FOR EACH STATEMENT EXECUTE FUNCTION dev_ledger_entries_append_only();
     END IF;
   END $$`,

  // One row per (account, mode, Idempotency-Key). Claimed before any work; the
  // body hash catches a key reused for a different request.
  `CREATE TABLE IF NOT EXISTS dev_idempotency_keys (
    account_id uuid NOT NULL REFERENCES dev_accounts(id) ON DELETE CASCADE,
    mode text NOT NULL CHECK (mode IN ('test', 'live')),
    key text NOT NULL,
    request_hash text NOT NULL,
    route text NOT NULL,
    resource_type text,
    resource_id uuid,
    status_code integer,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (account_id, mode, key)
  )`,
  `CREATE INDEX IF NOT EXISTS dev_idempotency_keys_created_idx ON dev_idempotency_keys (created_at)`,

  `CREATE TABLE IF NOT EXISTS dev_request_logs (
    id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES dev_accounts(id) ON DELETE CASCADE,
    key_id uuid,
    mode text NOT NULL CHECK (mode IN ('test', 'live')),
    method text NOT NULL,
    path text NOT NULL,
    status integer NOT NULL,
    duration_ms integer NOT NULL,
    error_code text,
    auth_failure text,
    ip text,
    user_agent text,
    idempotency_key text,
    request_body jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS dev_request_logs_account_idx ON dev_request_logs (account_id, mode, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS dev_request_logs_created_idx ON dev_request_logs (created_at)`,

  // Per-IP failed-authentication counter and block, shared by every instance.
  `CREATE TABLE IF NOT EXISTS dev_auth_failures (
    ip text PRIMARY KEY,
    window_start timestamptz NOT NULL DEFAULT now(),
    failures integer NOT NULL DEFAULT 0,
    blocked_until timestamptz
  )`,

  // Uploaded documents (business registration now; identity documents later).
  // Encrypted with the PII key before they reach this table.
  `CREATE TABLE IF NOT EXISTS dev_files (
    id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES dev_accounts(id) ON DELETE CASCADE,
    mode text NOT NULL CHECK (mode IN ('test', 'live')),
    purpose text NOT NULL,
    content_type text NOT NULL,
    size_bytes integer NOT NULL,
    sha256 text NOT NULL,
    data_enc bytea NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS dev_files_account_idx ON dev_files (account_id, created_at DESC)`,
];
