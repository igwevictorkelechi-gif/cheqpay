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
import { randomUUID } from "node:crypto";
import { ApiError } from "./http";
import { ensureUsdAsset } from "./ensureUsdAsset";
import { ensureCardTxnTypes } from "./ensureCardTxnTypes";
import { fundCard, withdrawFromCard } from "./maplerad/issuing";
import { getPricing } from "./settings";
import { cardFundFee, cardIssueFee, cardWithdrawFee } from "./fees";
import { isDefiniteRejection } from "./providerErrors";

export interface CardMovementResult {
  transactionId: string;
  status: TransactionStatus;
  /** Our fee on this movement, in cents. */
  feeCents?: bigint;
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
  // The top-up lands on the card in full; our fee is added on top (and refuses
  // anything under the minimum top-up).
  const feeCents = cardFundFee(cents, await getPricing());
  const totalCents = cents + feeCents;
  const card = await loadSpendableCard(input.userId, input.cardId);

  await Promise.all([ensureUsdAsset(), ensureCardTxnTypes()]);

  const existing = await prisma.transaction.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    select: { id: true, status: true, userId: true },
  });
  if (existing) {
    // Only ever replay the caller's own request.
    if (existing.userId !== input.userId) {
      throw new ApiError(409, "Idempotency-Key already used", "idempotency_conflict");
    }
    return { transactionId: existing.id, status: existing.status };
  }

  const tx = await prisma.$transaction(async (db) => {
    const debit = await db.balance.updateMany({
      where: { userId: input.userId, asset: Asset.USD, available: { gte: totalCents } },
      data: { available: { decrement: totalCents } },
    });
    if (debit.count !== 1) {
      throw new ApiError(
        422,
        feeCents > 0n ? "Insufficient USD balance (top-up + fee)" : "Insufficient USD balance",
        "insufficient_funds"
      );
    }
    return db.transaction.create({
      data: {
        userId: input.userId,
        type: TransactionType.CARD_FUND,
        asset: Asset.USD,
        amount: cents,
        fee: feeCents,
        status: TransactionStatus.PROCESSING,
        idempotencyKey: input.idempotencyKey,
        metadata: { cardId: card.id, providerCardId: card.providerCardId, direction: "fund" },
      },
    });
  });

  try {
    await fundCard(card.providerCardId!, Number(cents));
  } catch (err) {
    if (!isDefiniteRejection(err)) {
      // No clear answer — the card may have been loaded. Refunding now could
      // pay twice, so the row stays in flight for reconciliation.
      console.error("[cards] funding outcome unknown — reconcile before refunding", {
        userId: input.userId,
        transactionId: tx.id,
        error: String(err),
      });
      throw new ApiError(
        504,
        "Your top-up is being confirmed. Please check the card balance shortly before trying again.",
        "card_fund_pending",
      );
    }
    // Refused outright — the card was not funded. Return the money and fail
    // the row, claiming it first so this can only ever happen once.
    await prisma.$transaction(async (db) => {
      const claimed = await db.transaction.updateMany({
        where: { id: tx.id, status: TransactionStatus.PROCESSING },
        data: { status: TransactionStatus.FAILED },
      });
      if (claimed.count !== 1) return;
      await db.balance.update({
        where: { userId_asset: { userId: input.userId, asset: Asset.USD } },
        data: { available: { increment: totalCents } },
      });
    });
    throw new ApiError(502, "Could not load the card; you were not charged", "card_fund_failed");
  }

  await prisma.transaction.update({
    where: { id: tx.id },
    data: { status: TransactionStatus.COMPLETED },
  });
  return { transactionId: tx.id, status: TransactionStatus.COMPLETED, feeCents };
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
  // The whole amount comes off the card; our fee comes out of it, and the
  // rest lands in the wallet.
  const feeCents = cardWithdrawFee(await getPricing());
  if (cents <= feeCents) {
    throw new ApiError(
      422,
      `That amount doesn't cover the $${(Number(feeCents) / 100).toFixed(2)} withdrawal fee`,
      "below_fee"
    );
  }
  const creditCents = cents - feeCents;
  const card = await loadSpendableCard(input.userId, input.cardId);

  await Promise.all([ensureUsdAsset(), ensureCardTxnTypes()]);

  const existing = await prisma.transaction.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    select: { id: true, status: true, userId: true },
  });
  if (existing) {
    // Only ever replay the caller's own request.
    if (existing.userId !== input.userId) {
      throw new ApiError(409, "Idempotency-Key already used", "idempotency_conflict");
    }
    return { transactionId: existing.id, status: existing.status };
  }

  // Recorded before the provider call so a replay of the same key cannot debit
  // the card twice; carries no balance change until the money actually arrives.
  const tx = await prisma.transaction.create({
    data: {
      userId: input.userId,
      type: TransactionType.CARD_WITHDRAW,
      asset: Asset.USD,
      // amount = what reaches the wallet, fee = ours; together, what left the card.
      amount: creditCents,
      fee: feeCents,
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
        update: { available: { increment: creditCents } },
        create: { userId: input.userId, asset: Asset.USD, available: creditCents },
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
        cents: creditCents.toString(),
      },
      err,
    );
    throw new ApiError(
      500,
      "The withdrawal is being processed; your balance will update shortly.",
      "card_withdraw_credit_pending",
    );
  }

  return { transactionId: tx.id, status: TransactionStatus.COMPLETED, feeCents };
}

// --- The price of a card -------------------------------------------------------

/**
 * Charge the card price from the user's USD balance, before the card is
 * requested. Recorded as a CARD_ISSUE row whose `fee` is the price (amount 0:
 * nothing is moved anywhere, the whole charge is ours). Returns null when
 * cards are free.
 */
export async function chargeCardIssueFee(
  userId: string,
  requestKey: string = randomUUID(),
): Promise<{ transactionId: string; feeCents: bigint } | null> {
  const feeCents = cardIssueFee(await getPricing());
  if (feeCents <= 0n) return null;
  await Promise.all([ensureUsdAsset(), ensureCardTxnTypes()]);

  const tx = await prisma.$transaction(async (db) => {
    const debit = await db.balance.updateMany({
      where: { userId, asset: Asset.USD, available: { gte: feeCents } },
      data: { available: { decrement: feeCents } },
    });
    if (debit.count !== 1) {
      throw new ApiError(
        422,
        `A card costs $${(Number(feeCents) / 100).toFixed(2)}. Add USD to your wallet first.`,
        "insufficient_funds"
      );
    }
    return db.transaction.create({
      data: {
        userId,
        type: TransactionType.CARD_ISSUE,
        asset: Asset.USD,
        amount: 0n,
        fee: feeCents,
        status: TransactionStatus.COMPLETED,
        idempotencyKey: cardIssueKey(userId, requestKey),
        metadata: { direction: "issue" },
      },
      select: { id: true },
    });
  });
  return { transactionId: tx.id, feeCents };
}

/** The ledger key of a card-price charge for one create request. */
export function cardIssueKey(userId: string, requestKey: string): string {
  return `card-issue:${userId}:${requestKey}`;
}

/** Note which card request a card-price charge paid for, so a failure can refund it. */
export async function linkCardIssueFee(transactionId: string, reference: string): Promise<void> {
  await prisma.transaction.update({ where: { id: transactionId }, data: { externalRef: reference } });
}

/**
 * Give the card price back: the card was never created. Idempotent — only a
 * COMPLETED charge is refunded, and it becomes REVERSED in the same step.
 */
export async function refundCardIssueFee(where: { transactionId?: string; reference?: string }): Promise<void> {
  await prisma.$transaction(async (db) => {
    const tx = await db.transaction.findFirst({
      where: {
        type: TransactionType.CARD_ISSUE,
        status: TransactionStatus.COMPLETED,
        ...(where.transactionId ? { id: where.transactionId } : { externalRef: where.reference }),
      },
    });
    if (!tx) return;
    const flipped = await db.transaction.updateMany({
      where: { id: tx.id, status: TransactionStatus.COMPLETED },
      data: { status: TransactionStatus.REVERSED },
    });
    if (flipped.count !== 1) return;
    await db.balance.update({
      where: { userId_asset: { userId: tx.userId, asset: Asset.USD } },
      data: { available: { increment: tx.fee } },
    });
  });
}
