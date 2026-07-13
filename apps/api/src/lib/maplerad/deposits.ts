// apps/api/src/lib/maplerad/deposits.ts
//
// Deposit flow: a customer's dedicated NGN virtual account receives a bank
// transfer -> Maplerad credits the business wallet and fires a collection
// webhook -> we credit that user's Cheqpay in-app balance.
//
// This module owns only the DECISION logic and is decoupled from the database
// via a LedgerPort you implement against Prisma/Supabase. That keeps it unit-
// testable and keeps DB concerns out of the webhook route.
//
// Idempotency is mandatory: Maplerad retries webhooks, so the same collection
// can arrive more than once. We dedupe on the Maplerad transaction id inside a
// single transaction with the balance credit.

import type { CollectionEventData, MapleradWebhookEvent } from "./types";

export interface CreditResult {
  outcome: "credited" | "duplicate" | "unmatched" | "ignored";
  userId?: string;
  amount?: number; // minor units actually credited
  reason?: string;
}

/**
 * Port your data layer must implement. All calls should run inside ONE DB
 * transaction so the dedupe check and the balance credit commit atomically.
 */
export interface LedgerPort {
  /** True if we've already processed this Maplerad transaction id. */
  hasProcessed(providerTxId: string): Promise<boolean>;

  /** Resolve the Cheqpay user that owns a virtual account. */
  findUserByAccount(input: {
    accountId?: string;
    accountNumber?: string;
    customerId?: string;
  }): Promise<{ userId: string } | null>;

  /**
   * Atomically: record the provider tx id (dedupe) AND credit the user's NGN
   * balance by `amountMinor`. Must be idempotent if called twice for the same
   * providerTxId (unique constraint on providerTxId is the simplest guarantee).
   */
  creditUser(input: {
    userId: string;
    amountMinor: number;
    currency: string;
    providerTxId: string;
    reference?: string;
    raw: CollectionEventData;
  }): Promise<void>;
}

/** Statuses we treat as a settled, creditable deposit. */
const CREDITABLE_STATUSES = new Set(["SUCCESS", "SUCCESSFUL", "COMPLETED"]);

/**
 * Handle one collection/deposit webhook event. Returns a structured outcome so
 * the route can log/monitor without throwing on the non-error branches
 * (duplicate / unmatched are expected, not failures).
 */
export async function handleCollectionEvent(
  event: MapleradWebhookEvent<CollectionEventData>,
  ledger: LedgerPort,
): Promise<CreditResult> {
  const data = event.data;
  if (!data || !data.id) {
    return { outcome: "ignored", reason: "missing transaction id" };
  }

  // Only credit settled deposits. If Maplerad sends a status, honor it.
  if (data.status && !CREDITABLE_STATUSES.has(data.status.toUpperCase())) {
    return { outcome: "ignored", reason: `status=${data.status}` };
  }

  if (!Number.isInteger(data.amount) || data.amount <= 0) {
    return { outcome: "ignored", reason: `bad amount=${data.amount}` };
  }

  if (await ledger.hasProcessed(data.id)) {
    return { outcome: "duplicate", amount: data.amount };
  }

  const match = await ledger.findUserByAccount({
    accountId: data.account_id,
    accountNumber: data.account_number,
    customerId: data.customer_id,
  });
  if (!match) {
    // Don't throw — surface for manual reconciliation, still return 200 so
    // Maplerad stops retrying an event we structurally can't place.
    return { outcome: "unmatched", amount: data.amount };
  }

  await ledger.creditUser({
    userId: match.userId,
    amountMinor: data.amount,
    currency: data.currency,
    providerTxId: data.id,
    reference: data.reference,
    raw: data,
  });

  return {
    outcome: "credited",
    userId: match.userId,
    amount: data.amount,
  };
}
