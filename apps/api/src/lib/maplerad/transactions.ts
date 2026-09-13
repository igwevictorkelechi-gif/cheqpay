// apps/api/src/lib/maplerad/transactions.ts
//
// Reading a customer's transaction history back from Maplerad.
//
// This is the source of truth for reconciliation. The deposit webhook has been
// unreliable (deliveries stopped, and the collection payload that did arrive is
// flat and carries no amount), so when a deposit lands in the Maplerad wallet
// but never reaches the in-app balance, this endpoint is how we find it and
// credit it after the fact. GET /customers/{id}/transactions.

import { mapleradRequest } from "./client";

/**
 * One row from GET /customers/{id}/transactions.
 *
 * Every monetary field is a STRING here (unlike the webhook, where amounts are
 * integer minor units). The unit is not documented unambiguously — the sample
 * shows `"amount":"10000"` / `"fee":"5"` for NGN — so callers must interpret it
 * deliberately rather than trust a raw number. All fields are optional because
 * the sample shows `"null"` string literals and empty strings in places.
 */
export interface MapleradTransaction {
  id: string;
  /** "SUCCESS" for a settled transaction. */
  status?: string;
  /** "CREDIT" (money in) or "DEBIT" (money out). */
  entry?: string;
  /** e.g. "ACCOUNT". */
  channel?: string;
  /** e.g. "FUNDING" for a deposit. */
  type?: string;
  /** Amount as a string — unit must be interpreted (see reconcile.ts). */
  amount?: string;
  /** Maplerad's own fee, as a string. Distinct from our platform deposit fee. */
  fee?: string;
  /** "NGN" | "USD" | … */
  currency?: string;
  summary?: string;
  reason?: string;
  reference?: string;
  account_id?: string;
  created_at?: string;
  updated_at?: string;
  customer?: {
    id?: string;
    name?: string;
    email?: string;
    phone_number?: string;
    created_at?: string;
  };
  source?: {
    bank_name?: string | null;
    bank_code?: string | null;
    account_name?: string | null;
    account_number?: string | null;
  };
  [key: string]: unknown;
}

/**
 * Fetch every transaction Maplerad holds for a customer.
 *
 * Read-only. Returns the raw provider rows unchanged — deciding which are
 * creditable and how to interpret their amounts is reconcile.ts's job, kept
 * separate so this stays a thin, testable transport call.
 */
export async function getCustomerTransactions(
  customerId: string,
): Promise<MapleradTransaction[]> {
  const data = await mapleradRequest<MapleradTransaction[] | null>(
    `/customers/${encodeURIComponent(customerId)}/transactions`,
  );
  // A customer with no history returns an empty list; guard against null/`data`
  // absent so callers always get an array.
  return Array.isArray(data) ? data : [];
}
