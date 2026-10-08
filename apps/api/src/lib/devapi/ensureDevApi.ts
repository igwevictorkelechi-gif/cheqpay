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

  // ---- Phase 2: customers, virtual accounts, deposits, conversions, events ----

  // A developer's own customers (end users), one per person per mode: the BVN
  // fingerprint is unique per account and mode. Everything identifying is
  // encrypted with the PII key; the fingerprint is a keyed hash, so it can't be
  // reversed into a BVN. The encrypted columns are nullable so sandbox records
  // can be scrubbed after 90 days without breaking the money history.
  `CREATE TABLE IF NOT EXISTS dev_customers (
    id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES dev_accounts(id) ON DELETE RESTRICT,
    mode text NOT NULL CHECK (mode IN ('test', 'live')),
    first_name text NOT NULL,
    middle_name text,
    last_name text NOT NULL,
    email text NOT NULL,
    phone text NOT NULL,
    dob_enc text,
    address_enc text,
    bvn_enc text,
    bvn_fingerprint text NOT NULL,
    bvn_last4 text NOT NULL,
    id_type text NOT NULL,
    id_number_enc text,
    id_front_file_id uuid,
    id_back_file_id uuid,
    kyc_status text NOT NULL DEFAULT 'pending' CHECK (kyc_status IN ('pending', 'verified', 'rejected')),
    kyc_reason text,
    kyc_attempts integer NOT NULL DEFAULT 0,
    kyc_next_attempt_at timestamptz,
    kyc_submitted_at timestamptz NOT NULL DEFAULT now(),
    verified_at timestamptz,
    provider_customer_id text,
    provider_tier integer NOT NULL DEFAULT 0,
    reference text,
    metadata jsonb NOT NULL DEFAULT '{}',
    redacted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS dev_customers_bvn_uidx ON dev_customers (account_id, mode, bvn_fingerprint)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS dev_customers_reference_uidx ON dev_customers (account_id, mode, reference) WHERE reference IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS dev_customers_provider_uidx ON dev_customers (provider_customer_id) WHERE provider_customer_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS dev_customers_account_idx ON dev_customers (account_id, mode, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS dev_customers_fingerprint_idx ON dev_customers (bvn_fingerprint)`,
  `CREATE INDEX IF NOT EXISTS dev_customers_retry_idx ON dev_customers (kyc_next_attempt_at) WHERE kyc_status = 'pending'`,
  `CREATE UNIQUE INDEX IF NOT EXISTS dev_customers_front_file_uidx ON dev_customers (id_front_file_id) WHERE id_front_file_id IS NOT NULL`,
  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dev_wallets_customer_fk') THEN
       ALTER TABLE dev_wallets ADD CONSTRAINT dev_wallets_customer_fk FOREIGN KEY (customer_id) REFERENCES dev_customers(id) ON DELETE RESTRICT;
     END IF;
   END $$`,

  // A customer's NGN virtual account (a dedicated bank account number). At most
  // one open or opening per customer; 'failed' attempts are kept for history.
  `CREATE TABLE IF NOT EXISTS dev_virtual_accounts (
    id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES dev_accounts(id) ON DELETE RESTRICT,
    mode text NOT NULL CHECK (mode IN ('test', 'live')),
    customer_id uuid NOT NULL REFERENCES dev_customers(id) ON DELETE RESTRICT,
    wallet_id uuid NOT NULL REFERENCES dev_wallets(id) ON DELETE RESTRICT,
    currency text NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),
    status text NOT NULL CHECK (status IN ('creating', 'active', 'failed', 'closed')),
    account_number text,
    bank_name text,
    account_name text,
    provider_account_id text,
    reference text,
    metadata jsonb NOT NULL DEFAULT '{}',
    failure_reason text,
    deposits_checked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS dev_virtual_accounts_customer_uidx ON dev_virtual_accounts (customer_id) WHERE status IN ('creating', 'active')`,
  `CREATE UNIQUE INDEX IF NOT EXISTS dev_virtual_accounts_provider_uidx ON dev_virtual_accounts (provider_account_id) WHERE provider_account_id IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS dev_virtual_accounts_number_uidx ON dev_virtual_accounts (mode, account_number) WHERE account_number IS NOT NULL AND status = 'active'`,
  `CREATE UNIQUE INDEX IF NOT EXISTS dev_virtual_accounts_reference_uidx ON dev_virtual_accounts (account_id, mode, reference) WHERE reference IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS dev_virtual_accounts_account_idx ON dev_virtual_accounts (account_id, mode, created_at DESC)`,

  // A deposit is credited once per provider transaction, whichever path (the
  // webhook, a reconciliation) reaches it first.
  `CREATE UNIQUE INDEX IF NOT EXISTS dev_transactions_deposit_uidx ON dev_transactions (provider_ref) WHERE kind = 'deposit'`,
  `CREATE INDEX IF NOT EXISTS dev_transactions_customer_idx ON dev_transactions (customer_id, created_at DESC) WHERE customer_id IS NOT NULL`,

  // NGN<->USD quotes: bound to the account and mode that asked, single use
  // (claimed by flipping status), and short-lived.
  `CREATE TABLE IF NOT EXISTS dev_fx_quotes (
    id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES dev_accounts(id) ON DELETE RESTRICT,
    mode text NOT NULL CHECK (mode IN ('test', 'live')),
    from_currency text NOT NULL CHECK (from_currency IN ('NGN', 'USD')),
    to_currency text NOT NULL CHECK (to_currency IN ('NGN', 'USD') AND to_currency <> from_currency),
    amount_minor bigint NOT NULL CHECK (amount_minor > 0),
    gross_out_minor bigint NOT NULL CHECK (gross_out_minor > 0),
    fee_minor bigint NOT NULL CHECK (fee_minor >= 0),
    net_out_minor bigint NOT NULL CHECK (net_out_minor > 0),
    rate numeric NOT NULL,
    margin_bps integer NOT NULL,
    provider_ref text,
    status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'used')),
    transaction_id uuid,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS dev_fx_quotes_account_idx ON dev_fx_quotes (account_id, mode, created_at DESC)`,

  // Events (the record of what happened, kept 30 days) and their webhook
  // deliveries. A delivery row is written in the same transaction as the
  // change it reports, so a committed change can't lose its notification.
  `CREATE TABLE IF NOT EXISTS dev_events (
    id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES dev_accounts(id) ON DELETE CASCADE,
    mode text NOT NULL CHECK (mode IN ('test', 'live')),
    type text NOT NULL,
    data jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS dev_events_account_idx ON dev_events (account_id, mode, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS dev_events_created_idx ON dev_events (created_at)`,

  `CREATE TABLE IF NOT EXISTS dev_webhook_endpoints (
    id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES dev_accounts(id) ON DELETE CASCADE,
    mode text NOT NULL CHECK (mode IN ('test', 'live')),
    url text NOT NULL,
    description text,
    events text[] NOT NULL,
    secret_enc text NOT NULL,
    previous_secret_enc text,
    previous_secret_expires_at timestamptz,
    status text NOT NULL DEFAULT 'enabled' CHECK (status IN ('enabled', 'disabled')),
    disabled_reason text,
    failing_since timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS dev_webhook_endpoints_account_idx ON dev_webhook_endpoints (account_id, mode)`,

  `CREATE TABLE IF NOT EXISTS dev_webhook_deliveries (
    id uuid PRIMARY KEY,
    event_id uuid NOT NULL REFERENCES dev_events(id) ON DELETE CASCADE,
    endpoint_id uuid NOT NULL REFERENCES dev_webhook_endpoints(id) ON DELETE CASCADE,
    account_id uuid NOT NULL,
    status text NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed')),
    attempts integer NOT NULL DEFAULT 0,
    next_attempt_at timestamptz,
    locked_until timestamptz,
    last_status_code integer,
    last_error text,
    last_attempt_at timestamptz,
    delivered_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (event_id, endpoint_id)
  )`,
  `CREATE INDEX IF NOT EXISTS dev_webhook_deliveries_due_idx ON dev_webhook_deliveries (next_attempt_at) WHERE status = 'pending'`,
  `CREATE INDEX IF NOT EXISTS dev_webhook_deliveries_endpoint_idx ON dev_webhook_deliveries (endpoint_id, created_at DESC)`,

  // Short leases so a background job runs on one instance at a time.
  `CREATE TABLE IF NOT EXISTS dev_job_locks (
    name text PRIMARY KEY,
    locked_until timestamptz NOT NULL
  )`,
];
