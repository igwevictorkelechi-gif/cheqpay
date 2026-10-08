import type { Currency, Mode, Scope } from "@cheqpay/devapi";

export type { Currency, Mode, Scope };

export type AccountStatus = "sandbox" | "pending_review" | "approved" | "rejected" | "suspended";

/** A dev_accounts row as read back from the database. */
export interface AccountRow {
  id: string;
  owner_user_id: string;
  business_name: string;
  status: AccountStatus;
  status_before_suspension: AccountStatus | null;
  legal_name: string | null;
  rc_number: string | null;
  business_type: string | null;
  website: string | null;
  use_case: string | null;
  expected_monthly_volume: string | null;
  contact_phone: string | null;
  address: string | null;
  cac_file_id: string | null;
  submitted_at: Date | null;
  review_note: string | null;
  reviewed_by: string | null;
  reviewed_at: Date | null;
  live_since: Date | null;
  daily_out_limit_ngn: bigint | null;
  daily_out_limit_usd: bigint | null;
  max_float_ngn: bigint | null;
  max_float_usd: bigint | null;
  require_ip_allowlist: boolean;
  frozen: boolean;
  frozen_reason: string | null;
  frozen_by: "owner" | "admin" | "system" | null;
  suspended_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface KeyRow {
  id: string;
  account_id: string;
  mode: Mode;
  label: string;
  key_hash: string;
  last4: string;
  scopes: string[];
  allowed_ips: string[];
  expires_at: Date | null;
  revoked_at: Date | null;
  revoked_reason: string | null;
  last_used_at: Date | null;
  last_used_ip: string | null;
  created_at: Date;
}

export interface SubscriptionRow {
  account_id: string;
  plan_id: string;
  status: "active" | "past_due" | "canceled";
  current_period_start: Date;
  current_period_end: Date;
  cancel_at_period_end: boolean;
  next_plan_id: string | null;
  past_due_since: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface WalletRow {
  id: string;
  account_id: string;
  mode: Mode;
  customer_id: string | null;
  currency: Currency;
  available_minor: bigint;
  status: "active" | "frozen";
  frozen_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

export type TransactionKind =
  | "top_up"
  | "wallet_move"
  | "subscription"
  | "deposit"
  | "transfer"
  | "conversion"
  | "bill_payment"
  | "card_issue"
  | "card_funding"
  | "card_withdrawal"
  | "fee"
  | "adjustment";

export type TransactionStatus = "pending" | "successful" | "failed" | "reversed";

export interface DevTransactionRow {
  id: string;
  account_id: string;
  mode: Mode;
  kind: TransactionKind;
  status: TransactionStatus;
  currency: Currency;
  amount_minor: bigint;
  fee_minor: bigint;
  wallet_id: string | null;
  counterparty_wallet_id: string | null;
  customer_id: string | null;
  reference: string | null;
  description: string | null;
  metadata: Record<string, unknown>;
  details: Record<string, unknown>;
  provider_ref: string | null;
  app_ledger_tx_id: string | null;
  failure_code: string | null;
  failure_message: string | null;
  initiator_ip: string | null;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
}

export interface LedgerEntryRow {
  id: bigint;
  wallet_id: string;
  transaction_id: string;
  kind: string;
  amount_minor: bigint;
  balance_after: bigint;
  created_at: Date;
}

export type KycStatus = "pending" | "verified" | "rejected";
export type IdentityType = "NIN" | "PASSPORT" | "VOTERS_CARD" | "DRIVERS_LICENSE";

/** A dev_customers row. The *_enc columns are ciphertext and never leave the server. */
export interface CustomerRow {
  id: string;
  account_id: string;
  mode: Mode;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  email: string;
  phone: string;
  dob_enc: string | null;
  address_enc: string | null;
  bvn_enc: string | null;
  bvn_fingerprint: string;
  bvn_last4: string;
  id_type: IdentityType;
  id_number_enc: string | null;
  id_front_file_id: string | null;
  id_back_file_id: string | null;
  kyc_status: KycStatus;
  kyc_reason: string | null;
  kyc_attempts: number;
  kyc_next_attempt_at: Date | null;
  kyc_submitted_at: Date;
  verified_at: Date | null;
  provider_customer_id: string | null;
  provider_tier: number;
  reference: string | null;
  metadata: Record<string, string>;
  redacted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface VirtualAccountRow {
  id: string;
  account_id: string;
  mode: Mode;
  customer_id: string;
  wallet_id: string;
  currency: "NGN";
  status: "creating" | "active" | "failed" | "closed";
  account_number: string | null;
  bank_name: string | null;
  account_name: string | null;
  provider_account_id: string | null;
  reference: string | null;
  metadata: Record<string, string>;
  failure_reason: string | null;
  deposits_checked_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface FxQuoteRow {
  id: string;
  account_id: string;
  mode: Mode;
  from_currency: Currency;
  to_currency: Currency;
  amount_minor: bigint;
  gross_out_minor: bigint;
  fee_minor: bigint;
  net_out_minor: bigint;
  rate: { toString(): string };
  margin_bps: number;
  provider_ref: string | null;
  status: "open" | "used";
  transaction_id: string | null;
  expires_at: Date;
  created_at: Date;
}

export interface EventRow {
  id: string;
  account_id: string;
  mode: Mode;
  type: string;
  data: Record<string, unknown>;
  created_at: Date;
}

export interface EndpointRow {
  id: string;
  account_id: string;
  mode: Mode;
  url: string;
  description: string | null;
  events: string[];
  secret_enc: string;
  previous_secret_enc: string | null;
  previous_secret_expires_at: Date | null;
  status: "enabled" | "disabled";
  disabled_reason: string | null;
  failing_since: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface DeliveryRow {
  id: string;
  event_id: string;
  endpoint_id: string;
  account_id: string;
  status: "pending" | "succeeded" | "failed";
  attempts: number;
  next_attempt_at: Date | null;
  locked_until: Date | null;
  last_status_code: number | null;
  last_error: string | null;
  last_attempt_at: Date | null;
  delivered_at: Date | null;
  created_at: Date;
}
