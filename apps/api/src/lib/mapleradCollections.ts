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

/** One idempotency key per Maplerad transaction id, shared by both halves. */
function creditKey(providerTxId: string): string {
  return `deposit:maplerad:${providerTxId}`;
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
}): Promise<{ userId: string } | null> {
  if (input.accountNumber) {
    const wallet = await prisma.wallet.findFirst({
      where: {
        asset: Asset.NGN,
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
        asset: Asset.NGN,
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
    // Maplerad sends kobo, which is already our storage unit — no conversion,
    // and deliberately no float ever touches this path.
    const amountMinor = BigInt(input.amountMinor);
    const feeMinor = feeFromBps(amountMinor, await getDepositFeeBps());

    const credit = await creditBalance({
      userId: input.userId,
      asset: Asset.NGN,
      amountMinor,
      feeMinor,
      type: TransactionType.DEPOSIT,
      idempotencyKey: creditKey(input.providerTxId),
      network: Network.FIAT,
      externalRef: input.reference ?? input.providerTxId,
      metadata: {
        source: "virtual_account",
        provider: "maplerad",
        eventId: input.providerTxId,
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: input.userId,
        action: "ngn.deposit.credited",
        resourceType: "Transaction",
        resourceId: credit.transactionId,
        details: {
          amountMinor: amountMinor.toString(),
          feeMinor: feeMinor.toString(),
          providerTxId: input.providerTxId,
          via: "maplerad_collection",
        },
      },
    });

    // Only on the first credit: a webhook retry must not re-notify or pay
    // cashback twice.
    if (!credit.created) return;

    // After the credit commits, and on the GROSS amount — cashback is earned on
    // what the user actually paid in, matching finalizeDeposit. awardCashback
    // swallows its own errors by contract, so a reward problem cannot unwind a
    // deposit that already landed.
    await awardCashback({
      userId: input.userId,
      source: "deposit",
      baseNgnMinor: amountMinor,
      sourceTransactionId: credit.transactionId,
    });

    const net = amountMinor - feeMinor;
    await notifyUser(input.userId, {
      category: "deposits",
      title: "Money received",
      body: `₦${fromMinorUnits(net, Asset.NGN)} has landed in your CheqPay wallet.`,
    }).catch((err) => {
      console.error("[maplerad collection] notification failed", err);
    });
  },
};

export type { CollectionEventData };
