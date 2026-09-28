// apps/api/src/lib/cardIssue.ts
//
// Getting a virtual card, in the order the customer sees it:
//
//   1. Pay the card fee ($3) from the USD balance. This reserves a card slot —
//      a card row in status "unfunded" — and calls no provider yet.
//   2. Fund it: choose a first top-up (at least the minimum top-up). The top-up
//      and its fee are debited, and only now is the card requested from
//      Maplerad, with the top-up loaded onto it at creation.
//   3. Maplerad confirms by webhook; the card goes pending -> active.
//
// Why the provider call waits for step 2: a card at Maplerad costs the business
// money the moment it exists, and a card nobody funded is dead weight. Paying
// the fee first means someone who stops halfway keeps a paid slot and can come
// back to it (or cancel it for a refund) without paying twice.
//
// Money safety:
//   - every debit is guarded on the balance and recorded before any provider
//     call; a refused provider call refunds the top-up in full;
//   - the fee row and the top-up row both carry the card's creation reference,
//     so an issuing failure reported later by webhook refunds both
//     (refundCardIssueFee with a reference);
//   - the slot is claimed with a status flip, so a double tap can't activate
//     (or charge for) the same card twice.

import { Asset, TransactionStatus, TransactionType, prisma } from "@cheqpay/db";
import { ApiError } from "./http";
import { ensureCardsTable } from "./ensureCards";
import { ensureUsdAsset } from "./ensureUsdAsset";
import { ensureCardTxnTypes } from "./ensureCardTxnTypes";
import { chargeCardIssueFee, refundCardIssueFee } from "./cardFunding";
import { cardFundFee } from "./fees";
import { getPricing } from "./settings";
import { createCard } from "./maplerad/issuing";
import { minor } from "./maplerad/types";
import { getProviderBalanceMinor } from "./maplerad/treasury";
import { describeProviderError } from "./mapleradCustomer";
import { alertOpsOnce } from "./opsAlert";

export const UNFUNDED = "unfunded";
const ACTIVATING = "activating";

const CARD_SELECT = {
  id: true,
  currency: true,
  brand: true,
  maskedPan: true,
  status: true,
  createdAt: true,
} as const;

/** The ledger reference a paid-but-unfunded card's fee row carries until the card is requested. */
export function slotRef(cardId: string): string {
  return `card-slot:${cardId}`;
}

function toUsdCents(amount: string): bigint {
  if (!/^\d+(\.\d{1,2})?$/.test(amount)) {
    throw new ApiError(422, "Enter a dollar amount like 10 or 10.50", "bad_amount");
  }
  const [whole, frac = ""] = amount.split(".");
  return BigInt(whole) * 100n + BigInt(frac.padEnd(2, "0"));
}

async function requireEnrolledCustomer(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { mapleradCustomerId: true },
  });
  if (!user?.mapleradCustomerId) {
    throw new ApiError(
      409,
      "Complete your identity verification (KYC) before creating a card.",
      "kyc_required",
    );
  }
  return user.mapleradCustomerId;
}

/**
 * Step 1: pay the card fee and reserve a card slot.
 *
 * A person who already has a paid, unfunded card gets that card back instead
 * of paying again. A repeat of the same request key does the same.
 */
export async function payForCard(userId: string, requestKey: string) {
  await ensureCardsTable();
  await requireEnrolledCustomer(userId);

  const waiting = await prisma.card.findFirst({
    where: { userId, status: UNFUNDED },
    orderBy: { createdAt: "desc" },
    select: CARD_SELECT,
  });
  if (waiting) return { card: waiting, feeCents: 0n, alreadyPaid: true };

  const charge = await chargeCardIssueFee(userId, requestKey);
  const card = await prisma.card.create({
    data: { userId, provider: "maplerad", currency: "USD", status: UNFUNDED },
    select: CARD_SELECT,
  });
  if (charge) {
    await prisma.transaction.update({
      where: { id: charge.transactionId },
      data: { externalRef: slotRef(card.id), metadata: { direction: "issue", cardId: card.id } },
    });
  }
  return { card, feeCents: charge?.feeCents ?? 0n, alreadyPaid: false };
}

/**
 * Step 2: fund the card and have it created.
 *
 * Debits the top-up plus its fee, then asks Maplerad for the card with the
 * top-up loaded on it. Any refusal returns the top-up and puts the card back to
 * "unfunded", so the person can try again; the card fee stays paid for that
 * slot (cancelCard refunds it if they give up).
 */
export async function activateCard(input: {
  userId: string;
  cardId: string;
  amount: string;
  idempotencyKey: string;
}) {
  await ensureCardsTable();
  await Promise.all([ensureUsdAsset(), ensureCardTxnTypes()]);
  const customerId = await requireEnrolledCustomer(input.userId);

  const cents = toUsdCents(input.amount);
  const feeCents = cardFundFee(cents, await getPricing()); // enforces the minimum top-up
  const totalCents = cents + feeCents;

  // A replay of the same request returns the card as it now is.
  const prior = await prisma.transaction.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    select: { userId: true, metadata: true },
  });
  if (prior) {
    if (prior.userId !== input.userId) {
      throw new ApiError(409, "Idempotency-Key already used", "idempotency_conflict");
    }
    const card = await prisma.card.findFirst({
      where: { id: input.cardId, userId: input.userId },
      select: CARD_SELECT,
    });
    if (!card) throw new ApiError(404, "Card not found", "not_found");
    return { card, feeCents };
  }

  const card = await prisma.card.findFirst({
    where: { id: input.cardId, userId: input.userId },
    select: { id: true, status: true },
  });
  if (!card) throw new ApiError(404, "Card not found", "not_found");
  if (card.status !== UNFUNDED) {
    throw new ApiError(409, "This card has already been funded.", "card_not_unfunded");
  }

  // The business pays Maplerad for the card and its load from its own USD
  // wallet. Refuse up front, before touching the customer's money, when that
  // wallet can't cover the load — otherwise every attempt fails at Maplerad.
  const businessUsd = await getProviderBalanceMinor("USD");
  if (businessUsd !== null && businessUsd < cents) {
    void alertOpsOnce(
      "card-treasury-low",
      `⚠️ A customer tried to create a card with a $${(Number(cents) / 100).toFixed(2)} top-up, but the Maplerad USD wallet holds only $${(Number(businessUsd) / 100).toFixed(2)}. Top up the Maplerad USD wallet.`,
      { neededCents: cents.toString(), heldCents: businessUsd.toString() },
    );
    throw new ApiError(
      503,
      "Card creation is briefly unavailable. Nothing was charged for the top-up — please try again later.",
      "card_issuing_unavailable",
    );
  }

  // Claim the slot and take the top-up in one step.
  const fundTx = await prisma.$transaction(async (db) => {
    const claimed = await db.card.updateMany({
      where: { id: card.id, userId: input.userId, status: UNFUNDED },
      data: { status: ACTIVATING },
    });
    if (claimed.count !== 1) {
      throw new ApiError(409, "This card is already being set up.", "card_in_progress");
    }
    const debit = await db.balance.updateMany({
      where: { userId: input.userId, asset: Asset.USD, available: { gte: totalCents } },
      data: { available: { decrement: totalCents } },
    });
    if (debit.count !== 1) {
      throw new ApiError(
        422,
        `You need $${(Number(totalCents) / 100).toFixed(2)} in your USD balance for this top-up (including the $${(Number(feeCents) / 100).toFixed(2)} fee).`,
        "insufficient_funds",
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
        metadata: { cardId: card.id, direction: "fund", initial: true },
      },
      select: { id: true },
    });
  });

  let reference: string;
  try {
    const ack = await createCard({ customerId, currency: "USD", amount: minor(Number(cents)) });
    reference = ack.reference;
  } catch (err) {
    // Nothing was created: give the top-up back and reopen the slot.
    await prisma.$transaction(async (db) => {
      const failed = await db.transaction.updateMany({
        where: { id: fundTx.id, status: TransactionStatus.PROCESSING },
        data: { status: TransactionStatus.FAILED },
      });
      if (failed.count === 1) {
        await db.balance.update({
          where: { userId_asset: { userId: input.userId, asset: Asset.USD } },
          data: { available: { increment: totalCents } },
        });
      }
      await db.card.updateMany({
        where: { id: card.id, status: ACTIVATING },
        data: { status: UNFUNDED },
      });
    });
    const reason = describeProviderError(err);
    console.error("[cards] issuing failed", { userId: input.userId, customerId, error: reason });
    await prisma.auditLog
      .create({
        data: {
          userId: input.userId,
          action: "card.issue_failed",
          resourceType: "Card",
          resourceId: card.id,
          details: { reason, topUpCents: cents.toString(), refunded: true },
        },
      })
      .catch(() => undefined);
    void alertOpsOnce(
      "card-issue-failed",
      `⚠️ Virtual card creation is failing. The customer's top-up was refunded. Reason: ${reason}. If it says "upstream unreachable", the egress proxy is blocking /issuing — run Provider check in the admin.`,
      { reason },
    );
    throw new ApiError(
      502,
      "We couldn't create your card just now. Your top-up was returned to your USD balance and your card fee is saved — please try again shortly.",
      "card_issuing_unavailable",
    );
  }

  // Requested. Both money rows now point at the creation reference, so an
  // issuing failure reported by webhook refunds the fee and the top-up.
  const [updated] = await prisma.$transaction([
    prisma.card.update({
      where: { id: card.id },
      data: { status: "pending", reference },
      select: CARD_SELECT,
    }),
    prisma.transaction.update({
      where: { id: fundTx.id },
      data: { status: TransactionStatus.COMPLETED, externalRef: reference },
    }),
    prisma.transaction.updateMany({
      where: {
        userId: input.userId,
        type: TransactionType.CARD_ISSUE,
        externalRef: slotRef(card.id),
      },
      data: { externalRef: reference },
    }),
  ]);
  return { card: updated, feeCents };
}

/** Give up on a paid, unfunded card: refund its fee and remove the slot. */
export async function cancelUnfundedCard(userId: string, cardId: string): Promise<void> {
  await ensureCardsTable();
  const removed = await prisma.card.deleteMany({
    where: { id: cardId, userId, status: UNFUNDED },
  });
  if (removed.count !== 1) {
    throw new ApiError(409, "Only a card that hasn't been funded yet can be cancelled.", "card_not_unfunded");
  }
  await refundCardIssueFee({ reference: slotRef(cardId) });
}
