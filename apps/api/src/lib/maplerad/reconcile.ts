// apps/api/src/lib/maplerad/reconcile.ts
//
// Deposit reconciliation: find money that landed in a customer's Maplerad wallet
// but never reached their in-app balance, and credit it after the fact.
//
// Why this exists. The live deposit path is the webhook, and it has failed two
// ways at once: deliveries stopped arriving, and the one collection payload that
// did arrive is flat and carries no amount, so it credits nothing. The customer
// transactions endpoint is the authoritative record of what actually settled, so
// it is the source of truth for recovering missed deposits.
//
// Two safety rules shape every decision here:
//
//  1. It shares ONE idempotency key with the webhook — `deposit:maplerad:${id}`,
//     keyed on the Maplerad transaction id. A deposit already credited by a
//     webhook is seen as credited here, and a deposit credited here will dedupe
//     a webhook that later arrives. The same money cannot be credited twice.
//
//  2. It never guesses. The transactions endpoint states amounts as strings with
//     no documented unit, so the amount is interpreted deliberately (the same
//     way the crypto path does) and every row is surfaced for an operator to
//     confirm before money moves. `preview` lists what would happen; `commit`
//     only credits the ids the operator picked.

import {
  Asset,
  Network,
  TransactionType,
  prisma,
} from "@cheqpay/db";
import { creditBalance } from "../ledger";
import { fromMinorUnits } from "../money";
import { notifyUser } from "../alerts";
import { awardCashback } from "../cashback";
import { feeFromBps, getDepositFeeBps } from "../settings";
import { ensureUsdAsset } from "../ensureUsdAsset";
import { toMinor } from "./cryptoDeposits";
import { getCustomerTransactions, type MapleradTransaction } from "./transactions";

/** Statuses that mean the money has really settled. */
const CREDITABLE_STATUSES = new Set(["SUCCESS", "SUCCESSFUL", "COMPLETED"]);

/**
 * Transaction types we treat as a fundable deposit.
 *
 * Deliberately narrow: a CREDIT entry can also be a swap settlement, a reversal
 * or a refund, each of which is already accounted for elsewhere in our ledger.
 * Crediting one of those here would double it. Only genuine incoming funding is
 * reconciled; anything else is shown to the operator but not offered for credit.
 */
const DEPOSIT_TYPES = /^(funding|deposit|collection|transfer_in|credit)$/i;

/** The wallet asset a deposit in this currency belongs to (fiat rails only). */
function assetForCurrency(currency?: string): Asset | null {
  switch ((currency ?? "").toUpperCase()) {
    case "NGN":
      return Asset.NGN;
    case "USD":
      return Asset.USD;
    default:
      return null;
  }
}

/** The idempotency key a webhook credit would use for this transaction. */
function creditKey(providerTxId: string): string {
  return `deposit:maplerad:${providerTxId}`;
}

/** The key the crypto path uses, checked too so an offramp is never doubled. */
function cryptoCreditKey(providerTxId: string): string {
  return `deposit:maplerad:crypto:${providerTxId}`;
}

export interface ReconcileItem {
  /** Maplerad transaction id — the dedupe key. */
  id: string;
  currency: string | null;
  /** Our asset the currency maps to, or null if we do not carry it. */
  asset: Asset | null;
  entry: string | null;
  status: string | null;
  type: string | null;
  /** The provider's amount string, shown verbatim so the operator can sanity-check. */
  rawAmount: string | null;
  /** Interpreted gross amount in minor units (string for JSON safety), or null. */
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
  /** If already credited, our ledger transaction id. */
  transactionId?: string;
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

/** Whether we already hold a ledger row for this transaction id. */
async function findExisting(
  id: string,
  asset: Asset | null,
): Promise<{ id: string } | null> {
  // Check the shared webhook key first. For USD, also check the crypto key: an
  // offramped stablecoin deposit is credited by the crypto path under a
  // different key, and must not be credited a second time from here.
  const keys = asset === Asset.USD ? [creditKey(id), cryptoCreditKey(id)] : [creditKey(id)];
  return prisma.transaction.findFirst({
    where: { idempotencyKey: { in: keys } },
    select: { id: true },
  });
}

/**
 * Turn a provider transaction into a review row, resolving whether it is
 * already credited and whether it could be credited now.
 */
async function toItem(tx: MapleradTransaction): Promise<ReconcileItem> {
  const currency = tx.currency ?? null;
  const asset = assetForCurrency(tx.currency);
  const entry = tx.entry ?? null;
  const status = tx.status ?? null;
  const type = tx.type ?? null;
  const rawAmount = typeof tx.amount === "string" && tx.amount.trim() ? tx.amount.trim() : null;

  const existing = await findExisting(tx.id, asset);
  const alreadyCredited = existing !== null;

  let amountMinor: bigint | null = null;
  let feeMinor = 0n;
  let netMinor: bigint | null = null;
  let netDisplay: string | null = null;
  let creditable = false;
  let reason: string | undefined;

  if (asset && rawAmount) {
    const parsed = toMinor(rawAmount, asset);
    if (parsed !== null && parsed > 0n) {
      amountMinor = parsed;
      feeMinor = feeFromBps(parsed, await getDepositFeeBps());
      netMinor = parsed - feeMinor;
      netDisplay =
        asset === Asset.NGN
          ? `₦${fromMinorUnits(netMinor, Asset.NGN)}`
          : `$${fromMinorUnits(netMinor, Asset.USD)}`;
    }
  }

  // Reasons are ordered from most to least specific so the operator sees the
  // real blocker, not the first tripwire.
  if (alreadyCredited) {
    // Nothing to do; not flagged as an error.
  } else if (entry && entry.toUpperCase() !== "CREDIT") {
    reason = "not an incoming credit";
  } else if (status && !CREDITABLE_STATUSES.has(status.toUpperCase())) {
    reason = `status ${status}`;
  } else if (!asset) {
    reason = `unsupported currency ${currency ?? "?"}`;
  } else if (type && !DEPOSIT_TYPES.test(type)) {
    reason = `not a deposit type (${type})`;
  } else if (amountMinor === null) {
    reason = `unreadable amount ${rawAmount ?? "?"}`;
  } else if (feeMinor >= amountMinor) {
    reason = "fee exceeds amount";
  } else {
    creditable = true;
  }

  return {
    id: tx.id,
    currency,
    asset,
    entry,
    status,
    type,
    rawAmount,
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
    transactionId: existing?.id,
    creditable,
    reason,
  };
}

/**
 * Fetch a customer's transactions and classify each for review. Credits nothing.
 */
export async function previewReconciliation(customerId: string): Promise<ReconcileResult> {
  const txns = await getCustomerTransactions(customerId);
  const items = await Promise.all(txns.map(toItem));
  return {
    ok: true,
    customerId,
    items,
    summary: summarise(items),
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
 * Credit one reconciled fiat deposit, mirroring the webhook credit exactly:
 * platform deposit fee withheld, NGN cashback earned, the owner notified, and an
 * audit row written. Idempotent on the shared key, so a racing webhook is safe.
 *
 * Returns the ledger transaction id and whether this call created it.
 */
async function creditReconciledDeposit(
  userId: string,
  asset: Asset,
  amountMinor: bigint,
  tx: MapleradTransaction,
): Promise<{ created: boolean; transactionId: string }> {
  const isNgn = asset === Asset.NGN;
  if (!isNgn) await ensureUsdAsset();

  const feeMinor = feeFromBps(amountMinor, await getDepositFeeBps());

  const credit = await creditBalance({
    userId,
    asset,
    amountMinor,
    feeMinor,
    type: TransactionType.DEPOSIT,
    idempotencyKey: creditKey(tx.id),
    network: Network.FIAT,
    externalRef:
      typeof tx.reference === "string" && tx.reference && tx.reference !== "null"
        ? tx.reference
        : tx.id,
    metadata: {
      source: "virtual_account",
      provider: "maplerad",
      currency: asset,
      eventId: tx.id,
      via: "reconciliation",
    },
  });

  await prisma.auditLog.create({
    data: {
      userId,
      action: isNgn ? "ngn.deposit.credited" : "usd.deposit.credited",
      resourceType: "Transaction",
      resourceId: credit.transactionId,
      details: {
        amountMinor: amountMinor.toString(),
        feeMinor: feeMinor.toString(),
        currency: asset,
        providerTxId: tx.id,
        via: "maplerad_reconciliation",
      },
    },
  });

  // Only on the first credit: cashback and the notification must not repeat if
  // this row was already credited by a webhook.
  if (!credit.created) return credit;

  if (isNgn) {
    await awardCashback({
      userId,
      source: "deposit",
      baseNgnMinor: amountMinor,
      sourceTransactionId: credit.transactionId,
    });
  }

  const net = amountMinor - feeMinor;
  const pretty = isNgn
    ? `₦${fromMinorUnits(net, Asset.NGN)}`
    : `$${fromMinorUnits(net, Asset.USD)}`;
  await notifyUser(userId, {
    category: "deposits",
    title: "Money received",
    body: `${pretty} has landed in your CheqPay wallet.`,
  }).catch((err) => {
    console.error("[reconcile] notification failed", err);
  });

  return credit;
}

/**
 * Credit the selected missing deposits for a user.
 *
 * `ids` names exactly which transactions to credit (what the operator ticked);
 * pass `all: true` to credit every creditable-and-missing row instead. A row
 * that is not creditable, or already credited, is skipped rather than forced —
 * the classification is re-derived from a fresh fetch, so a stale UI cannot
 * credit something that has since been handled.
 */
export async function commitReconciliation(
  userId: string,
  customerId: string,
  select: { ids?: string[]; all?: boolean },
): Promise<ReconcileResult> {
  const txns = await getCustomerTransactions(customerId);
  const byId = new Map(txns.map((t) => [t.id, t]));
  const items = await Promise.all(txns.map(toItem));

  const wanted = new Set(select.ids ?? []);
  const targets = items.filter((it) => {
    if (!it.creditable || it.alreadyCredited) return false;
    return select.all ? true : wanted.has(it.id);
  });

  let credited = 0;
  for (const it of targets) {
    const tx = byId.get(it.id);
    if (!tx || !it.asset || it.amountMinor === null) continue;
    const res = await creditReconciledDeposit(
      userId,
      it.asset,
      BigInt(it.amountMinor),
      tx,
    );
    if (res.created) {
      credited += 1;
      // Reflect the new state in the row we return.
      it.alreadyCredited = true;
      it.creditable = false;
      it.transactionId = res.transactionId;
    }
  }

  return {
    ok: true,
    customerId,
    items,
    summary: { ...summarise(items), credited },
  };
}
