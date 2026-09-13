// apps/api/src/lib/maplerad/settle.ts
//
// Crediting a collection deposit from its transaction id — the one path shared
// by the webhook (auto-credit on collection.successful) and the admin
// reconciliation tool (credit a deposit found after the fact).
//
// Both start from a Maplerad transaction id and nothing else. The collection
// webhook payload is flat and carries no amount, and the customer transaction
// index reports amount 0 — so the amount, currency and destination are fetched
// with verifyTransaction, and the credit runs through the SAME idempotent port
// the NGN/USD deposit path already uses (shared `deposit:maplerad:${id}` key),
// so a webhook and a manual reconciliation can never double-credit each other.

import { Asset } from "@cheqpay/db";
import { verifyTransaction, type VerifiedTransaction } from "./transactions";
import { prismaLedgerPort } from "../mapleradCollections";
import { creditCryptoCollection, isCryptoCollection } from "./cryptoCollection";
import type { CreditResult } from "./deposits";
import type { CollectionEventData } from "./types";

/** Statuses that mean the money has really settled. */
export const CREDITABLE_STATUSES = new Set(["SUCCESS", "SUCCESSFUL", "COMPLETED"]);

/**
 * Transaction types we treat as a fundable deposit. Narrow on purpose: a CREDIT
 * entry can also be a swap settlement or a reversal, each already accounted for
 * elsewhere, and crediting one here would double it.
 */
export const DEPOSIT_TYPES = /^(collection|funding|deposit)$/i;

/** The wallet asset a deposit in this currency belongs to (fiat rails only). */
export function assetForCurrency(currency?: string): Asset | null {
  switch ((currency ?? "").toUpperCase()) {
    case "NGN":
      return Asset.NGN;
    case "USD":
      return Asset.USD;
    default:
      return null;
  }
}

export interface Classification {
  creditable: boolean;
  reason?: string;
  asset: Asset | null;
}

/**
 * Decide whether a verified transaction is a settled, fundable deposit — the
 * same rules the webhook and the reconciliation preview both apply, so an
 * operator's "why not" matches exactly what an auto-credit would refuse.
 */
export function classifyVerified(tx: VerifiedTransaction): Classification {
  const asset = assetForCurrency(tx.currency);
  if (tx.entry && tx.entry.toUpperCase() !== "CREDIT") {
    return { creditable: false, reason: "not an incoming credit", asset };
  }
  if (tx.status && !CREDITABLE_STATUSES.has(tx.status.toUpperCase())) {
    return { creditable: false, reason: `status ${tx.status}`, asset };
  }
  if (!asset) {
    return { creditable: false, reason: `unsupported currency ${tx.currency ?? "?"}`, asset };
  }
  if (tx.type && !DEPOSIT_TYPES.test(tx.type)) {
    return { creditable: false, reason: `not a deposit type (${tx.type})`, asset };
  }
  if (!Number.isInteger(tx.amount) || tx.amount <= 0) {
    return { creditable: false, reason: `unreadable amount ${tx.amount}`, asset };
  }
  return { creditable: true, asset };
}

/**
 * Verify a transaction by id and credit its owner if it is a settled deposit.
 *
 * Returns a structured outcome rather than throwing on the expected non-credit
 * branches (duplicate / unmatched / ignored). It DOES throw when the verify call
 * itself fails, so the webhook can 500 and let Maplerad retry a transient error
 * rather than acknowledging a deposit it never actually read.
 */
export async function settleCollectionById(transactionId: string): Promise<CreditResult> {
  if (!transactionId) return { outcome: "ignored", reason: "no transaction id" };

  const tx = await verifyTransaction(transactionId);

  // A stablecoin deposit arrives as a COLLECTION too, but nothing about the
  // fiat path fits it: the currency is USDT/USDC, the destination account is
  // null, and `source` is the sender's chain address. Route it to the path that
  // understands that shape rather than letting it fall out as "unsupported
  // currency", which is what left a live USDT deposit uncredited.
  if (isCryptoCollection(tx)) {
    if (tx.entry && tx.entry.toUpperCase() !== "CREDIT") {
      return { outcome: "ignored", reason: "not an incoming credit" };
    }
    if (tx.status && !CREDITABLE_STATUSES.has(tx.status.toUpperCase())) {
      return { outcome: "ignored", reason: `status ${tx.status}` };
    }
    return creditCryptoCollection(tx);
  }

  const cls = classifyVerified(tx);
  if (!cls.creditable) return { outcome: "ignored", reason: cls.reason };

  if (await prismaLedgerPort.hasProcessed(tx.id)) {
    return { outcome: "duplicate", amount: tx.amount };
  }

  const match = await prismaLedgerPort.findUserByAccount({
    accountId: tx.account_id,
    customerId: tx.customer?.id,
    currency: tx.currency,
  });
  if (!match) return { outcome: "unmatched", amount: tx.amount };

  await prismaLedgerPort.creditUser({
    userId: match.userId,
    amountMinor: tx.amount,
    currency: tx.currency ?? "NGN",
    providerTxId: tx.id,
    reference: tx.reference ?? undefined,
    // The verified detail carries everything CollectionEventData needs (id,
    // amount, currency, account_id, reference); the shapes line up.
    raw: tx as unknown as CollectionEventData,
  });

  return { outcome: "credited", userId: match.userId, amount: tx.amount };
}
