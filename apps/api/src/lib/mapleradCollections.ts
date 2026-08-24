// apps/api/src/lib/mapleradCollections.ts
//
// The database half of NGN deposits: turning a Maplerad `collection.*` webhook
// into a balance credit for the right user.
//
// The decision logic (what counts as creditable, dedupe, matching) lives in
// lib/maplerad/deposits.ts behind a LedgerPort so it stays unit-testable with
// no database. This module is that port, implemented against Prisma.

import {
  Asset,
  Network,
  TransactionType,
  prisma,
} from "@cheqpay/db";
import type { CollectionEventData } from "./maplerad/types";
import type { LedgerPort } from "./maplerad/deposits";
import { creditBalance } from "./ledger";
import { fromMinorUnits } from "./money";
import { notifyUser } from "./alerts";
import { awardCashback } from "./cashback";
import { feeFromBps, getDepositFeeBps } from "./settings";
import { ensureUsdAsset } from "./ensureUsdAsset";

/** One idempotency key per Maplerad transaction id, shared by both halves. */
function creditKey(providerTxId: string): string {
  return `deposit:maplerad:${providerTxId}`;
}

/**
 * The wallet asset a deposit in this currency belongs to. Missing currency is
 * treated as NGN — that is what every collection was before USD accounts, so
 * older/ambiguous events keep crediting naira. An unknown currency returns null:
 * the deposit is then left unmatched for a human rather than credited as a guess.
 */
function assetForCurrency(currency?: string): Asset | null {
  switch ((currency ?? "NGN").toUpperCase()) {
    case "NGN":
      return Asset.NGN;
    case "USD":
      return Asset.USD;
    default:
      return null;
  }
}

/**
 * Find the user who owns a virtual account.
 *
 * Three routes, most to least reliable. The NUBAN is the strongest signal
 * because it is what the payer actually typed, so it is tried first; the
 * Maplerad ids are fallbacks for events that omit it.
 *
 * Deliberately conservative: if none of the three match, we return null and the
 * caller records the payment as unmatched for manual reconciliation. Guessing
 * an owner would credit real money to the wrong person.
 */
async function findOwner(input: {
  accountId?: string;
  accountNumber?: string;
  customerId?: string;
  currency?: string;
}): Promise<{ userId: string } | null> {
  // Match against the wallet for THIS currency's asset. A USD deposit must not
  // match an NGN account number that happens to look similar, and vice versa.
  const asset = assetForCurrency(input.currency);
  if (!asset) return null;

  if (input.accountNumber) {
    const wallet = await prisma.wallet.findFirst({
      where: {
        asset,
        network: Network.FIAT,
        address: input.accountNumber,
      },
      select: { userId: true },
    });
    if (wallet) return { userId: wallet.userId };
  }

  // custodyRef holds the provider ref as JSON; `contains` avoids parsing every
  // row, and the id is unique enough that a substring match cannot collide.
  if (input.accountId) {
    const wallet = await prisma.wallet.findFirst({
      where: {
        asset,
        network: Network.FIAT,
        custodyRef: { contains: input.accountId },
      },
      select: { userId: true },
    });
    if (wallet) return { userId: wallet.userId };
  }

  if (input.customerId) {
    const user = await prisma.user.findFirst({
      where: { mapleradCustomerId: input.customerId },
      select: { id: true },
    });
    if (user) return { userId: user.id };
  }

  return null;
}

export const prismaLedgerPort: LedgerPort = {
  async hasProcessed(providerTxId: string): Promise<boolean> {
    const existing = await prisma.transaction.findUnique({
      where: { idempotencyKey: creditKey(providerTxId) },
      select: { id: true },
    });
    return existing !== null;
  },

  findUserByAccount: findOwner,

  async creditUser(input): Promise<void> {
    const asset = assetForCurrency(input.currency);
    if (!asset) {
      // handleCollectionEvent only calls this after findOwner matched, which
      // itself refuses an unknown currency — so this is belt-and-braces.
      console.error("[maplerad collection] refusing to credit an unknown currency", {
        userId: input.userId,
        currency: input.currency,
        providerTxId: input.providerTxId,
      });
      return;
    }
    const isNgn = asset === Asset.NGN;

    // The USD balance lives on the same Asset enum as NGN; make sure the value
    // exists before the typed write (idempotent, and already run at account
    // opening, so normally a no-op).
    if (!isNgn) await ensureUsdAsset();

    // Maplerad sends minor units (kobo for NGN, cents for USD) — already our
    // storage unit, so no conversion and no float ever touches this path.
    const amountMinor = BigInt(input.amountMinor);
    const feeMinor = feeFromBps(amountMinor, await getDepositFeeBps());

    const credit = await creditBalance({
      userId: input.userId,
      asset,
      amountMinor,
      feeMinor,
      type: TransactionType.DEPOSIT,
      idempotencyKey: creditKey(input.providerTxId),
      network: Network.FIAT,
      externalRef: input.reference ?? input.providerTxId,
      metadata: {
        source: "virtual_account",
        provider: "maplerad",
        currency: asset,
        eventId: input.providerTxId,
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: input.userId,
        action: isNgn ? "ngn.deposit.credited" : "usd.deposit.credited",
        resourceType: "Transaction",
        resourceId: credit.transactionId,
        details: {
          amountMinor: amountMinor.toString(),
          feeMinor: feeMinor.toString(),
          currency: asset,
          providerTxId: input.providerTxId,
          via: "maplerad_collection",
        },
      },
    });

    // Only on the first credit: a webhook retry must not re-notify or pay
    // cashback twice.
    if (!credit.created) return;

    // Cashback is an NGN reward program measured in naira, so it is earned only
    // on naira deposits. A USD deposit lands without cashback rather than
    // inventing a naira value for it.
    if (isNgn) {
      await awardCashback({
        userId: input.userId,
        source: "deposit",
        baseNgnMinor: amountMinor,
        sourceTransactionId: credit.transactionId,
      });
    }

    const net = amountMinor - feeMinor;
    const pretty = isNgn
      ? `₦${fromMinorUnits(net, Asset.NGN)}`
      : `$${fromMinorUnits(net, Asset.USD)}`;
    await notifyUser(input.userId, {
      category: "deposits",
      title: "Money received",
      body: `${pretty} has landed in your CheqPay wallet.`,
    }).catch((err) => {
      console.error("[maplerad collection] notification failed", err);
    });
  },
};

export type { CollectionEventData };
