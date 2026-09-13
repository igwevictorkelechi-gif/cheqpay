// apps/api/src/lib/maplerad/reconcile.ts
//
// Deposit reconciliation: find money that settled in a customer's Maplerad
// account but never reached their in-app balance, and credit it after the fact.
//
// Why this exists. The live deposit path is the webhook, and it has been
// unreliable; even when it fires, its collection payload is flat and carries no
// amount. So the authoritative record is Maplerad's own transaction history.
//
// How it works. The customer transaction index (getCustomerTransactions) lists
// the deposit ids but reports amount 0, so each id is verified
// (verifyTransaction) to get the real amount, currency and destination. Crediting
// runs through settleCollectionById — the SAME idempotent path the webhook uses
// (shared `deposit:maplerad:${id}` key) — so a webhook and a reconciliation can
// never double-credit the same deposit.
//
// `preview` classifies every deposit and credits nothing; `commit` credits only
// the ids the operator picked (or all creditable-and-missing with `all`).

import { Asset } from "@cheqpay/db";
import { fromMinorUnits } from "../money";
import { feeFromBps, getDepositFeeBps } from "../settings";
import { prismaLedgerPort } from "../mapleradCollections";
import { getCustomerTransactions, verifyTransaction } from "./transactions";
import { classifyVerified, settleCollectionById } from "./settle";

export interface ReconcileItem {
  /** Maplerad transaction id — the dedupe key. */
  id: string;
  currency: string | null;
  /** Our asset the currency maps to, or null if we do not carry it. */
  asset: Asset | null;
  entry: string | null;
  status: string | null;
  type: string | null;
  /** The provider's amount (minor units) as a string, shown for a sanity check. */
  rawAmount: string | null;
  /** Verified gross amount in minor units (string for JSON safety), or null. */
  amountMinor: string | null;
  /** Our platform deposit fee on that amount, in minor units. */
  feeMinor: string | null;
  /** Gross − fee: what the balance would actually increase by. */
  netMinor: string | null;
  /** A human-readable rendering of the net, e.g. "₦100.00" / "$5.00". */
  netDisplay: string | null;
  reference: string | null;
  createdAt: string | null;
  source: {
    bankName: string | null;
    accountNumber: string | null;
    accountName: string | null;
  };
  /** True if this transaction id is already in our ledger. */
  alreadyCredited: boolean;
  /** True if it is a settled, fundable deposit we could credit now. */
  creditable: boolean;
  /** Why it is not creditable (when creditable is false and not already done). */
  reason?: string;
}

export interface ReconcileResult {
  ok: true;
  customerId: string;
  items: ReconcileItem[];
  summary: {
    total: number;
    alreadyCredited: number;
    creditableMissing: number;
    /** Set on a commit: how many were actually credited this call. */
    credited?: number;
  };
}

/**
 * Verify one deposit id and turn it into a review row. Credits nothing.
 *
 * A verify failure does not abort the whole reconciliation — the row is returned
 * un-creditable with a reason, so one bad id cannot hide every other deposit.
 */
async function toItem(transactionId: string, feeBps: number): Promise<ReconcileItem> {
  const blank: ReconcileItem = {
    id: transactionId,
    currency: null,
    asset: null,
    entry: null,
    status: null,
    type: null,
    rawAmount: null,
    amountMinor: null,
    feeMinor: null,
    netMinor: null,
    netDisplay: null,
    reference: null,
    createdAt: null,
    source: { bankName: null, accountNumber: null, accountName: null },
    alreadyCredited: false,
    creditable: false,
  };

  let tx;
  try {
    tx = await verifyTransaction(transactionId);
  } catch {
    return { ...blank, reason: "could not verify this transaction with Maplerad" };
  }

  const cls = classifyVerified(tx);
  const alreadyCredited = await prismaLedgerPort.hasProcessed(tx.id);

  let amountMinor: bigint | null = null;
  let feeMinor = 0n;
  let netMinor: bigint | null = null;
  let netDisplay: string | null = null;

  if (cls.asset && Number.isInteger(tx.amount) && tx.amount > 0) {
    amountMinor = BigInt(tx.amount);
    feeMinor = feeFromBps(amountMinor, feeBps);
    netMinor = amountMinor - feeMinor;
    netDisplay =
      cls.asset === Asset.NGN
        ? `₦${fromMinorUnits(netMinor, Asset.NGN)}`
        : `$${fromMinorUnits(netMinor, Asset.USD)}`;
  }

  return {
    id: tx.id,
    currency: tx.currency ?? null,
    asset: cls.asset,
    entry: tx.entry ?? null,
    status: tx.status ?? null,
    type: tx.type ?? null,
    rawAmount: Number.isFinite(tx.amount) ? String(tx.amount) : null,
    amountMinor: amountMinor?.toString() ?? null,
    feeMinor: amountMinor !== null ? feeMinor.toString() : null,
    netMinor: netMinor?.toString() ?? null,
    netDisplay,
    reference:
      typeof tx.reference === "string" && tx.reference && tx.reference !== "null"
        ? tx.reference
        : null,
    createdAt: tx.created_at ?? null,
    source: {
      bankName: tx.source?.bank_name ?? null,
      accountNumber: tx.source?.account_number ?? null,
      accountName: tx.source?.account_name ?? null,
    },
    alreadyCredited,
    creditable: cls.creditable && !alreadyCredited,
    reason: alreadyCredited ? undefined : cls.reason,
  };
}

function summarise(items: ReconcileItem[]): ReconcileResult["summary"] {
  return {
    total: items.length,
    alreadyCredited: items.filter((i) => i.alreadyCredited).length,
    creditableMissing: items.filter((i) => i.creditable && !i.alreadyCredited).length,
  };
}

/**
 * Fetch a customer's deposits and classify each for review. Credits nothing.
 */
export async function previewReconciliation(customerId: string): Promise<ReconcileResult> {
  const { deposit } = await getCustomerTransactions(customerId);
  const feeBps = await getDepositFeeBps();
  const items = await Promise.all(deposit.map((d) => toItem(d.transaction_id, feeBps)));
  return { ok: true, customerId, items, summary: summarise(items) };
}

/**
 * Credit the selected missing deposits.
 *
 * `ids` names exactly which transactions to credit; `all: true` credits every
 * creditable-and-missing row. Each credit goes through settleCollectionById,
 * which re-verifies and re-checks against the ledger, so a stale UI cannot
 * credit something that has since been handled, and the shared idempotency key
 * makes a racing webhook safe.
 */
export async function commitReconciliation(
  _userId: string,
  customerId: string,
  select: { ids?: string[]; all?: boolean },
): Promise<ReconcileResult> {
  const { deposit } = await getCustomerTransactions(customerId);
  const feeBps = await getDepositFeeBps();
  const items = await Promise.all(deposit.map((d) => toItem(d.transaction_id, feeBps)));

  const wanted = new Set(select.ids ?? []);
  const targets = items.filter((it) => {
    if (!it.creditable || it.alreadyCredited) return false;
    return select.all ? true : wanted.has(it.id);
  });

  let credited = 0;
  for (const it of targets) {
    const res = await settleCollectionById(it.id);
    if (res.outcome === "credited") {
      credited += 1;
      it.alreadyCredited = true;
      it.creditable = false;
    } else if (res.outcome === "duplicate") {
      it.alreadyCredited = true;
      it.creditable = false;
    } else if (res.outcome === "unmatched") {
      it.creditable = false;
      it.reason = "no CheqPay account matches this deposit";
    } else if (res.outcome === "ignored") {
      it.creditable = false;
      it.reason = res.reason ?? "not creditable";
    }
  }

  return {
    ok: true,
    customerId,
    items,
    summary: { ...summarise(items), credited },
  };
}
