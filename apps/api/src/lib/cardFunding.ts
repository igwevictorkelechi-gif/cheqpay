// apps/api/src/lib/cardFunding.ts
//
// Moving USD between a user's in-app balance and their virtual card.
//
// A card is funded from the business's Maplerad balance and withdrawn back to
// it, so from the user's side this is a transfer between two dollar balances
// they own: their in-app USD and their card. One US cent is one USD minor unit
// in our ledger, so no conversion — the amounts line up exactly.
//
// Both directions are money-safe and idempotent on the caller's key. The two
// orderings are deliberately different because the point of no return sits in a
// different place:
//
//   fund     — debit US first, THEN call the provider. A provider failure
//              refunds; the user is never left debited for a card that was not
//              credited.
//   withdraw — call the provider first (that debits the card), THEN credit the
//              user. A provider failure credits nothing; the card is untouched.

import {
  Asset,
  TransactionStatus,
  TransactionType,
  prisma,
} from "@cheqpay/db";
import { ApiError } from "./http";
import { ensureUsdAsset } from "./ensureUsdAsset";
import { ensureCardTxnTypes } from "./ensureCardTxnTypes";
import { fundCard, withdrawFromCard } from "./maplerad/issuing";

export interface CardMovementResult {
  transactionId: string;
  status: TransactionStatus;
  /** The card's new balance is not returned here — the caller re-reads it. */
}

/** A card that can move money: owned by the user, confirmed, and not frozen. */
async function loadSpendableCard(userId: string, cardId: string) {
  const card = await prisma.card.findFirst({
    where: { id: cardId, userId },
    select: { id: true, providerCardId: true, status: true, currency: true },
  });
  if (!card) throw new ApiError(404, "Card not found", "not_found");
  if (!card.providerCardId) {
    throw new ApiError(409, "This card is still being issued. Try again shortly.", "card_pending");
  }
  if (card.status === "frozen") {
    throw new ApiError(409, "This card is frozen. Unfreeze it first.", "card_frozen");
  }
  return card;
}

/** Validate a dollar amount (a string like "10" or "10.50") into cents. */
function toUsdCents(amount: string): bigint {
  if (!/^\d+(\.\d{1,2})?$/.test(amount)) {
    throw new ApiError(422, "Expected a USD amount like 10 or 10.50", "bad_amount");
  }
  const [whole, frac = ""] = amount.split(".");
  const cents = BigInt(whole) * 100n + BigInt(frac.padEnd(2, "0"));
  if (cents <= 0n) throw new ApiError(422, "Amount must be positive", "bad_amount");
  return cents;
}

/**
 * Move `amount` USD from the user's in-app balance onto their card.
 *
 * Debit is first and guarded on sufficient funds; only then is the provider
 * called. A provider error refunds the debit and marks the row FAILED, so a
 * failed fund never leaves the user out of pocket.
 */
export async function fundUserCard(input: {
  userId: string;
  cardId: string;
  amount: string;
  idempotencyKey: string;
}): Promise<CardMovementResult> {
  const cents = toUsdCents(input.amount);
  const card = await loadSpendableCard(input.userId, input.cardId);

  await Promise.all([ensureUsdAsset(), ensureCardTxnTypes()]);

  const existing = await prisma.transaction.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    select: { id: true, status: true },
  });
  if (existing) return { transactionId: existing.id, status: existing.status };

  const tx = await prisma.$transaction(async (db) => {
    const debit = await db.balance.updateMany({
      where: { userId: input.userId, asset: Asset.USD, available: { gte: cents } },
      data: { available: { decrement: cents } },
    });
    if (debit.count !== 1) {
      throw new ApiError(422, "Insufficient USD balance", "insufficient_funds");
    }
    return db.transaction.create({
      data: {
        userId: input.userId,
        type: TransactionType.CARD_FUND,
        asset: Asset.USD,
        amount: cents,
        status: TransactionStatus.PROCESSING,
        idempotencyKey: input.idempotencyKey,
        metadata: { cardId: card.id, providerCardId: card.providerCardId, direction: "fund" },
      },
    });
  });

  try {
    await fundCard(card.providerCardId!, Number(cents));
  } catch (err) {
    // The card was not funded — return the money and fail the row.
    await prisma.$transaction(async (db) => {
      await db.balance.update({
        where: { userId_asset: { userId: input.userId, asset: Asset.USD } },
        data: { available: { increment: cents } },
      });
      await db.transaction.update({
        where: { id: tx.id },
        data: { status: TransactionStatus.FAILED },
      });
    });
    throw new ApiError(502, "Could not load the card; you were not charged", "card_fund_failed");
  }

  await prisma.transaction.update({
    where: { id: tx.id },
    data: { status: TransactionStatus.COMPLETED },
  });
  return { transactionId: tx.id, status: TransactionStatus.COMPLETED };
}

/**
 * Move `amount` USD off the card back to the user's in-app balance.
 *
 * The provider is called first (that debits the card); only on its success is
 * the user credited. A provider error — including the card not having the funds
 * — credits nothing and marks the row FAILED. If the provider succeeds but the
 * credit then fails, the row is left PROCESSING and logged loudly for a manual
 * reconcile rather than silently dropping the user's money.
 */
export async function withdrawUserCard(input: {
  userId: string;
  cardId: string;
  amount: string;
  idempotencyKey: string;
}): Promise<CardMovementResult> {
  const cents = toUsdCents(input.amount);
  const card = await loadSpendableCard(input.userId, input.cardId);

  await Promise.all([ensureUsdAsset(), ensureCardTxnTypes()]);

  const existing = await prisma.transaction.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    select: { id: true, status: true },
  });
  if (existing) return { transactionId: existing.id, status: existing.status };

  // Recorded before the provider call so a replay of the same key cannot debit
  // the card twice; carries no balance change until the money actually arrives.
  const tx = await prisma.transaction.create({
    data: {
      userId: input.userId,
      type: TransactionType.CARD_WITHDRAW,
      asset: Asset.USD,
      amount: cents,
      status: TransactionStatus.PROCESSING,
      idempotencyKey: input.idempotencyKey,
      metadata: { cardId: card.id, providerCardId: card.providerCardId, direction: "withdraw" },
    },
  });

  try {
    await withdrawFromCard(card.providerCardId!, Number(cents));
  } catch (err) {
    await prisma.transaction.update({
      where: { id: tx.id },
      data: { status: TransactionStatus.FAILED },
    });
    throw new ApiError(
      502,
      "Could not withdraw from the card. Check the card balance and try again.",
      "card_withdraw_failed",
    );
  }

  // The card has been debited — credit the user. If this fails the money is in
  // the treasury, not lost; leave the row PROCESSING for a human to finish.
  try {
    await prisma.$transaction(async (db) => {
      await db.balance.upsert({
        where: { userId_asset: { userId: input.userId, asset: Asset.USD } },
        update: { available: { increment: cents } },
        create: { userId: input.userId, asset: Asset.USD, available: cents },
      });
      await db.transaction.update({
        where: { id: tx.id },
        data: { status: TransactionStatus.COMPLETED },
      });
    });
  } catch (err) {
    console.error(
      "[cards] card debited but crediting the user failed — reconcile",
      {
        userId: input.userId,
        cardId: card.id,
        transactionId: tx.id,
        cents: cents.toString(),
      },
      err,
    );
    throw new ApiError(
      500,
      "The withdrawal is being processed; your balance will update shortly.",
      "card_withdraw_credit_pending",
    );
  }

  return { transactionId: tx.id, status: TransactionStatus.COMPLETED };
}
