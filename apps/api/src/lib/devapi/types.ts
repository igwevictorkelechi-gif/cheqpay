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
