// apps/api/src/lib/maplerad/transactions.ts
//
// Reading a customer's history back from Maplerad, and verifying a single
// transaction to get its real amount.
//
// These are the source of truth for reconciliation and for crediting a deposit
// after the fact. The deposit webhook is unreliable and — even when it arrives —
// its collection payload is flat and carries NO amount, so the amount has to be
// fetched here.
//
// Two endpoints, two shapes, learned from the live API (the published docs were
// wrong about both):
//
//   GET /customers/{id}/transactions
//     -> data: { deposit: [...summaries...], withdrawal: [...] }
//     Each summary carries a `transaction_id` and the counterparty, but its
//     `amount` reads 0 — it is an index, not the amounts. Use it only to
//     discover which transaction ids exist.
//
//   GET /transactions/verify/{id}
//     -> data: { id, status, entry, type, amount, fee, currency, account_id,
//                customer, source, ... }
//     `amount` and `fee` are INTEGERS in minor units (kobo/cents) — the same
//     unit our ledger stores, so no float and no unit guessing. This is where
//     the real amount comes from.

import { mapleradRequest } from "./client";

/** One entry in the `deposit` array of a customer's transaction index. */
export interface DepositSummary {
  transaction_id: string;
  related_transaction_id?: string | null;
  account_name?: string;
  account_number?: string;
  bank_name?: string;
  bank_code?: string;
  /** Reads 0 in this index view — the real amount comes from verifyTransaction. */
  amount?: number;
}

/** The `data` object of GET /customers/{id}/transactions. */
export interface CustomerTransactions {
  deposit: DepositSummary[];
  withdrawal: unknown[];
}

/**
 * The full, verified detail of one transaction. Monetary fields are INTEGER
 * minor units (kobo/cents) — our storage unit.
 */
export interface VerifiedTransaction {
  id: string;
  status?: string; // "SUCCESS"
  entry?: string; // "CREDIT" | "DEBIT"
  type?: string; // "COLLECTION" for a virtual-account deposit
  amount: number; // minor units
  fee?: number; // Maplerad's own fee, minor units — distinct from our platform fee
  currency?: string; // "NGN" | "USD" | …
  channel?: string; // "BANKTRANSFER"
  summary?: string;
  reason?: string | null;
  reference?: string | null;
  /** The destination virtual account id — matches a wallet's custody ref. */
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

type Bag = Record<string, unknown>;

/**
 * Fetch a customer's transaction index and return the deposit/withdrawal lists.
 *
 * Tolerant of shape: the live API nests the lists under `data.{deposit,
 * withdrawal}`, but an older documented shape returned `data` as a flat array —
 * so a bare array is accepted too and read as the deposit list, rather than
 * silently returning nothing (the bug this replaces).
 */
export async function getCustomerTransactions(
  customerId: string,
): Promise<CustomerTransactions> {
  const data = await mapleradRequest<unknown>(
    `/customers/${encodeURIComponent(customerId)}/transactions`,
  );

  if (Array.isArray(data)) {
    // Legacy/flat shape: treat rows that look like deposits as the deposit list.
    const deposit = data.filter(
      (r): r is DepositSummary =>
        !!r && typeof r === "object" && typeof (r as Bag).transaction_id === "string",
    );
    return { deposit, withdrawal: [] };
  }

  const bag: Bag = data && typeof data === "object" ? (data as Bag) : {};
  const deposit = Array.isArray(bag.deposit) ? (bag.deposit as DepositSummary[]) : [];
  const withdrawal = Array.isArray(bag.withdrawal) ? (bag.withdrawal as unknown[]) : [];
  return { deposit, withdrawal };
}

/**
 * Verify a single transaction and return its real detail, including the amount.
 *
 * GET /transactions/verify/{id}. Read-only. Throws MapleradError when the id is
 * unknown or the request is refused — callers decide whether that is fatal (a
 * webhook wants a retry) or just a skipped row (reconciliation).
 */
export async function verifyTransaction(id: string): Promise<VerifiedTransaction> {
  return mapleradRequest<VerifiedTransaction>(
    `/transactions/verify/${encodeURIComponent(id)}`,
  );
}
