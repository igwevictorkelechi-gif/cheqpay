// apps/api/src/lib/devapi/cards.ts
//
// USD virtual cards for a developer's verified customers.
//
// A card is issued to one customer and funded from a USD wallet of the same
// owner (the customer's own, or the developer's main wallet). Live cards are
// issued by the same card partner the app uses; the money on a card lives at
// the partner, and our ledger records only what moved between a wallet and a
// card. Every movement follows the order the app's cards already use, because
// the point of no return sits in a different place for each:
//
//   issue    debit (first top-up + card price + top-up fee) and record, then
//            ask the partner for the card. Creation is asynchronous: the card
//            stays pending until the partner's webhook (or the sweep) says it
//            exists; a definite refusal, then or later, refunds everything.
//   fund     debit first, then load the card. Refused: refund. Unclear: hold.
//   withdraw take it off the card first, then credit the wallet. Refused:
//            nothing moved. Unclear: hold, never credit on a guess.
//
// The full card number and CVV are never stored. They are fetched from the
// partner when a key with the cards:details scope asks, at most ten times per
// card per hour, each reveal recorded.
//
// The sandbox issues instantly, keeps the card's balance in balance_minor, and
// never calls the partner.

import { randomBytes, randomUUID } from "node:crypto";
import { prisma, type Prisma } from "@cheqpay/db";
import { z } from "zod";
import { fromPublicId, toPublicId } from "@cheqpay/devapi";
import { getFeatureFlags } from "../features";
import { getPricing } from "../settings";
import { isDefiniteRejection } from "../providerErrors";
import { alertOpsOnce } from "../opsAlert";
import { createCard, freezeCard, fundCard, getCard, getCardTransactions, unfreezeCard, withdrawFromCard } from "../maplerad/issuing";
import { minor } from "../maplerad/types";
import { maskPan } from "../cards";
import { V1Error, type ApiContext, type HandlerResult } from "./handler";
import { effectiveLimits, getDevLimits } from "./limits";
import { applyLegs, assertWithinOutflowLimits, ensureCustomerWallets, getCustomerWallet, getTransaction, getWallet, insertTransaction } from "./ledger";
import { getCustomer } from "./customers";
import { recordEvent } from "./events";
import { deliverSoon } from "./webhooks";
import { recordDevAudit } from "./audit";
import { amountSchema, metadataSchema, referenceSchema, resolveId, uniqueViolation } from "./inputs";
import { runIdempotent } from "./idempotency";
import { transactionObject } from "./serialize";
import type { DevPlan } from "./plans";
import type { DevTransactionRow, Mode, WalletRow } from "./types";

const MONEY_TX = { maxWait: 10_000, timeout: 15_000 };

/** Reveals of one card's number allowed per hour. */
export const REVEALS_PER_HOUR = 10;

type Scope = { accountId: string; mode: Mode };

export interface CardRow {
  id: string;
  account_id: string;
  mode: Mode;
  customer_id: string;
  wallet_id: string;
  status: "pending" | "active" | "frozen" | "failed";
  brand: string;
  last4: string | null;
  expiry_month: number | null;
  expiry_year: number | null;
  provider_card_id: string | null;
  creation_ref: string | null;
  balance_minor: bigint;
  reference: string | null;
  metadata: Record<string, string>;
  failure_code: string | null;
  failure_message: string | null;
  issue_transaction_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export const cardCreateSchema = z
  .object({
    customer_id: z.string().max(80),
    amount: amountSchema,
    wallet_id: z.string().max(80).optional(),
    brand: z.enum(["VISA", "MASTERCARD"]).optional(),
    reference: referenceSchema.optional(),
    metadata: metadataSchema.optional(),
  })
  .strict();

export const cardMoveSchema = z
  .object({
    amount: amountSchema,
    wallet_id: z.string().max(80).optional(),
    reference: referenceSchema.optional(),
    metadata: metadataSchema.optional(),
  })
  .strict();

export const testPurchaseSchema = z
  .object({
    amount: amountSchema,
    merchant_name: z.string().trim().min(1).max(60).regex(/^[\p{L}\p{N} .,'&*-]+$/u, "Letters, digits and simple punctuation").optional(),
  })
  .strict();

/** The fee on loading `amountCents` onto a card: basis points of the top-up. */
export function cardFundFeeFor(plan: Pick<DevPlan, "cardFundFeeBps">, amountCents: bigint): bigint {
  return (amountCents * BigInt(plan.cardFundFeeBps)) / 10_000n;
}

/** The smallest first top-up or top-up, in cents: the app's minimum. */
export async function minCardFundCents(): Promise<bigint> {
  return BigInt(Math.round((await getPricing()).cardFundMinUsd * 100));
}

export function cardObject(c: CardRow, liveBalance?: number | null) {
  return {
    object: "card",
    id: toPublicId("card", c.id),
    customer_id: toPublicId("customer", c.customer_id),
    wallet_id: toPublicId("wallet", c.wallet_id),
    status: c.status,
    brand: c.brand,
    last4: c.last4,
    expiry_month: c.expiry_month,
    expiry_year: c.expiry_year,
    currency: "USD",
    // Sandbox: the simulated balance. Live: read from the issuer when one card
    // is retrieved; null in lists and while the card is being issued.
    balance: c.mode === "test" ? Number(c.balance_minor) : (liveBalance ?? null),
    reference: c.reference,
    metadata: c.metadata ?? {},
    failure: c.failure_code ? { code: c.failure_code, message: c.failure_message } : null,
    livemode: c.mode === "live",
    created_at: c.created_at.toISOString(),
  };
}

export async function getCardRow(scope: Scope, id: string): Promise<CardRow | null> {
  const rows = await prisma.$queryRawUnsafe<CardRow[]>(
    `SELECT * FROM dev_cards WHERE id = $1::uuid AND account_id = $2::uuid AND mode = $3`,
    id,
    scope.accountId,
    scope.mode,
  );
  return rows[0] ?? null;
}

async function cardById(db: Prisma.TransactionClient | typeof prisma, id: string): Promise<CardRow | null> {
  const rows = await db.$queryRawUnsafe<CardRow[]>(`SELECT * FROM dev_cards WHERE id = $1::uuid`, id);
  return rows[0] ?? null;
}

async function assertCardsOpen(mode: Mode): Promise<void> {
  if (mode === "live" && !(await getFeatureFlags()).virtual_cards) {
    throw new V1Error(503, "Cards are temporarily unavailable.", "feature_disabled");
  }
}

/** A USD wallet that may fund (or receive from) this customer's card: theirs, or a main wallet. */
async function cardWallet(db: Prisma.TransactionClient | typeof prisma, scope: Scope, customerId: string, walletPublicId: string | undefined): Promise<WalletRow> {
  let wallet: WalletRow | null;
  if (walletPublicId) {
    wallet = await getWallet(db, scope, resolveId("wallet", walletPublicId, "wallet_id", "wallet"));
    if (!wallet) throw new V1Error(404, "No such wallet.", "not_found", "wallet_id");
  } else {
    await ensureCustomerWallets(db, scope.accountId, scope.mode, customerId);
    wallet = await getCustomerWallet(db, customerId, "USD");
    if (!wallet) throw new V1Error(404, "No such wallet.", "not_found", "wallet_id");
  }
  if (wallet.currency !== "USD") {
    throw new V1Error(400, `Cards are in US dollars; that wallet holds ${wallet.currency}.`, "currency_mismatch", "wallet_id");
  }
  if (wallet.customer_id && wallet.customer_id !== customerId) {
    throw new V1Error(400, "Use this customer's own wallet or your main wallet.", "validation_error", "wallet_id");
  }
  return wallet;
}

function sandboxCardFields() {
  const last4 = String(1000 + (randomBytes(2).readUInt16BE(0) % 9000));
  const year = new Date().getUTCFullYear() + 3;
  return { last4, expiryMonth: 12, expiryYear: year, providerCardId: `test_card_${randomBytes(8).toString("hex")}` };
}

/** "MM/YY" or "MM/YYYY" → [month, four-digit year]. */
export function parseExpiry(raw: unknown): [number, number] | null {
  if (typeof raw !== "string") return null;
  const m = /^(\d{1,2})\s*\/\s*(\d{2}|\d{4})$/.exec(raw.trim());
  if (!m) return null;
  const month = Number(m[1]);
  const year = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
  return month >= 1 && month <= 12 ? [month, year] : null;
}

// ---------------------------------------------------------------------------
// Issue

export async function createDevCard(ctx: ApiContext<z.infer<typeof cardCreateSchema>>, initiatorIp: string | null): Promise<HandlerResult> {
  const b = ctx.body;
  const customerId = resolveId("customer", b.customer_id, "customer_id", "customer");
  const amount = BigInt(b.amount);

  return runIdempotent(ctx, b, {
    replay: async (txId) => {
      const tx = (await getTransaction(prisma, ctx.scope, txId))!;
      const card = (await cardById(prisma, fromPublicId("card", (tx.details as Record<string, unknown>).card_id)!))!;
      return { status: card.status === "pending" ? 202 : 201, body: cardObject(card) };
    },
    work: async (complete) => {
      await assertCardsOpen(ctx.mode);
      const customer = await getCustomer(ctx.scope, customerId);
      if (!customer) throw new V1Error(404, "No such customer.", "not_found", "customer_id");
      if (customer.kyc_status !== "verified") {
        throw new V1Error(409, "Cards are only for verified customers.", "kyc_required", "customer_id");
      }
      if (ctx.mode === "live" && !customer.provider_customer_id) {
        throw new V1Error(409, "This customer's verification is still finishing. Try again shortly.", "kyc_required", "customer_id");
      }
      const min = await minCardFundCents();
      if (amount < min) throw new V1Error(400, `A card's first top-up is at least ${min} cents.`, "validation_error", "amount");

      const count = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT count(*)::bigint AS n FROM dev_cards WHERE account_id = $1::uuid AND mode = $2 AND status IN ('pending', 'active', 'frozen')`,
        ctx.scope.accountId,
        ctx.scope.mode,
      );
      if (Number(count[0]?.n ?? 0) >= ctx.plan.maxActiveCards) {
        throw new V1Error(403, `Your plan allows ${ctx.plan.maxActiveCards.toLocaleString("en-US")} cards in ${ctx.mode} mode.`, "plan_limit_reached");
      }

      const issueFee = BigInt(ctx.plan.cardIssueFeeCents);
      const fundFee = cardFundFeeFor(ctx.plan, amount);
      const total = amount + issueFee + fundFee;
      const limits = ctx.mode === "live" ? effectiveLimits(ctx.account, await getDevLimits()) : null;
      const isTest = ctx.mode === "test";
      const cardId = randomUUID();
      const sandbox = isTest ? sandboxCardFields() : null;
      const brand = b.brand ?? "VISA";

      let txId: string;
      let eventId: string | null = null;
      try {
        txId = await prisma.$transaction(async (db) => {
          const wallet = await cardWallet(db, ctx.scope, customer.id, b.wallet_id);
          if (limits) await assertWithinOutflowLimits(db, ctx.account, "USD", total, limits);
          await db.$executeRawUnsafe(
            `INSERT INTO dev_cards (id, account_id, mode, customer_id, wallet_id, status, brand, last4, expiry_month, expiry_year,
               provider_card_id, balance_minor, reference, metadata)
             VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5::uuid, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb)`,
            cardId,
            ctx.scope.accountId,
            ctx.scope.mode,
            customer.id,
            wallet.id,
            isTest ? "active" : "pending",
            brand,
            sandbox?.last4 ?? null,
            sandbox?.expiryMonth ?? null,
            sandbox?.expiryYear ?? null,
            sandbox?.providerCardId ?? null,
            isTest ? amount : 0n,
            b.reference ?? null,
            JSON.stringify(b.metadata ?? {}),
          );
          const id = await insertTransaction(db, {
            accountId: ctx.scope.accountId,
            mode: ctx.scope.mode,
            kind: "card_issue",
            status: isTest ? "successful" : "pending",
            currency: "USD",
            amountMinor: amount,
            feeMinor: issueFee + fundFee,
            walletId: wallet.id,
            customerId: customer.id,
            reference: b.reference ?? null,
            metadata: b.metadata ?? {},
            details: { card_id: toPublicId("card", cardId), card_fee: Number(issueFee), funding_fee: Number(fundFee) },
            initiatorIp,
          });
          await db.$executeRawUnsafe(`UPDATE dev_cards SET issue_transaction_id = $2::uuid WHERE id = $1::uuid`, cardId, id);
          await applyLegs(db, ctx.scope, id, "USD", [
            { walletId: wallet.id, amountMinor: -amount, kind: "card_funding" },
            { walletId: wallet.id, amountMinor: -(issueFee + fundFee), kind: "fee" },
          ]);
          await complete(db, "transaction", id, isTest ? 201 : 202);
          if (isTest) {
            eventId = await recordEvent(db, { accountId: ctx.scope.accountId, mode: ctx.scope.mode, type: "card.active", object: cardObject((await cardById(db, cardId))!) });
          }
          return id;
        }, MONEY_TX);
      } catch (err) {
        const cols = uniqueViolation(err);
        if (cols?.includes("reference")) throw new V1Error(409, "Another card or transaction already uses this reference.", "duplicate_reference", "reference");
        throw err;
      }

      if (isTest) {
        if (eventId) deliverSoon([eventId]);
        return { status: 201, body: cardObject((await cardById(prisma, cardId))!) };
      }

      // Live: ask the partner for the card, with the first top-up loaded on it.
      try {
        const ack = await createCard({ customerId: customer.provider_customer_id!, brand, amount: minor(Number(amount)) });
        if (!ack?.reference) throw Object.assign(new Error("no reference in the issuing answer"), { unclear: true });
        await prisma.$executeRawUnsafe(`UPDATE dev_cards SET creation_ref = $2, updated_at = now() WHERE id = $1::uuid`, cardId, ack.reference);
      } catch (err) {
        if (isDefiniteRejection(err)) {
          await failCard(cardId, "card_refused", "The card issuer refused this card. The top-up and fees were returned to the wallet.");
        } else {
          console.error("[devapi] card issue outcome unknown — left pending", { card: cardId, transaction: txId, error: err instanceof Error ? err.message : String(err) });
          await alertOpsOnce(
            `devapi-card-unknown:${cardId}`,
            "⚠️ Developer API: a live card request got no clear answer from the issuer. The card is pending and the customer was charged; check the issuer and activate or refund it by hand.",
            { developer_account: ctx.scope.accountId, card: toPublicId("card", cardId) },
          );
        }
      }
      const card = (await cardById(prisma, cardId))!;
      return { status: card.status === "pending" ? 202 : 201, body: cardObject(card) };
    },
  });
}

/**
 * The issuer confirmed a pending card: record its id and number's last four,
 * mark the issue transaction successful, send card.active. Guarded on pending,
 * so the webhook and the sweep can both arrive. Null if already settled.
 */
export async function activateCard(cardId: string, info: { providerCardId: string; maskedPan?: unknown; expiry?: unknown; brand?: unknown }): Promise<CardRow | null> {
  const last4 = maskPan(info.maskedPan)?.slice(-4) ?? null;
  const expiry = parseExpiry(info.expiry);
  const brand = typeof info.brand === "string" && /^(VISA|MASTERCARD)$/i.test(info.brand) ? info.brand.toUpperCase() : null;
  let eventId: string | null = null;
  const card = await prisma.$transaction(async (db) => {
    const moved = await db.$queryRawUnsafe<CardRow[]>(
      `UPDATE dev_cards SET status = 'active', provider_card_id = $2, last4 = COALESCE($3, last4),
          expiry_month = COALESCE($4, expiry_month), expiry_year = COALESCE($5, expiry_year), brand = COALESCE($6, brand), updated_at = now()
        WHERE id = $1::uuid AND status = 'pending' RETURNING *`,
      cardId,
      info.providerCardId,
      last4,
      expiry?.[0] ?? null,
      expiry?.[1] ?? null,
      brand,
    );
    const c = moved[0];
    if (!c) return null;
    if (c.issue_transaction_id) {
      await db.$executeRawUnsafe(
        `UPDATE dev_transactions SET status = 'successful', completed_at = now(), updated_at = now() WHERE id = $1::uuid AND status = 'pending'`,
        c.issue_transaction_id,
      );
    }
    eventId = await recordEvent(db, { accountId: c.account_id, mode: c.mode, type: "card.active", object: cardObject(c) });
    return c;
  }, MONEY_TX);
  if (eventId) deliverSoon([eventId]);
  return card;
}

/** The card will never exist: fail it, refund its first top-up and fees, send card.failed. Null if already settled. */
export async function failCard(cardId: string, code: string, message: string): Promise<CardRow | null> {
  let eventId: string | null = null;
  const card = await prisma.$transaction(async (db) => {
    const moved = await db.$queryRawUnsafe<CardRow[]>(
      `UPDATE dev_cards SET status = 'failed', failure_code = $2, failure_message = $3, updated_at = now()
        WHERE id = $1::uuid AND status = 'pending' RETURNING *`,
      cardId,
      code,
      message,
    );
    const c = moved[0];
    if (!c) return null;
    if (c.issue_transaction_id) {
      const tx = await db.$queryRawUnsafe<DevTransactionRow[]>(
        `UPDATE dev_transactions SET status = 'failed', failure_code = $2, failure_message = $3, completed_at = now(), updated_at = now()
          WHERE id = $1::uuid AND status = 'pending' RETURNING *`,
        c.issue_transaction_id,
        code,
        message,
      );
      if (tx[0]) {
        await applyLegs(db, { accountId: c.account_id, mode: c.mode }, tx[0].id, "USD", [
          { walletId: tx[0].wallet_id!, amountMinor: tx[0].amount_minor, kind: "card_refund" },
          { walletId: tx[0].wallet_id!, amountMinor: tx[0].fee_minor, kind: "fee_refund" },
        ]);
      }
    }
    eventId = await recordEvent(db, { accountId: c.account_id, mode: c.mode, type: "card.failed", object: cardObject(c) });
    return c;
  }, MONEY_TX);
  if (eventId) deliverSoon([eventId]);
  return card;
}

/**
 * The issuer's webhook for a card no app user requested: settle the developer
 * card with this creation reference. False if none matches.
 */
export async function finalizeDevCard(input: { reference: string; cardId?: string; status: string; raw: Record<string, unknown> }): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `SELECT id FROM dev_cards WHERE creation_ref = $1 AND mode = 'live'`,
    input.reference,
  );
  const id = rows[0]?.id;
  if (!id) return false;
  const status = input.status.toUpperCase();
  if ((status === "SUCCESS" || status === "SUCCESSFUL" || status === "ACTIVE") && input.cardId) {
    await activateCard(id, { providerCardId: input.cardId, maskedPan: input.raw.masked_pan, expiry: input.raw.expiry, brand: input.raw.brand ?? input.raw.issuer });
  } else if (/^(FAILED|FAILURE|DECLINED|REJECTED|ERROR)$/.test(status)) {
    await failCard(id, "card_failed", "The card issuer could not create this card. The top-up and fees were returned to the wallet.");
  }
  return true;
}

// ---------------------------------------------------------------------------
// Fund and withdraw

function usableCard(card: CardRow | null): CardRow {
  if (!card) throw new V1Error(404, "No such card.", "not_found", "id");
  if (card.status === "pending") throw new V1Error(409, "This card is still being issued.", "card_not_active");
  if (card.status === "failed") throw new V1Error(409, "This card was never issued.", "card_not_active");
  if (card.status === "frozen") throw new V1Error(409, "This card is frozen. Unfreeze it first.", "card_not_active");
  return card;
}

async function settleMovement(txId: string, scope: Scope, ok: boolean, legs: { walletId: string; amountMinor: bigint; kind: string }[], event: "card.funded" | "card.withdrawn" | null, failure?: { code: string; message: string }) {
  let eventId: string | null = null;
  const tx = await prisma.$transaction(async (db) => {
    const done = await db.$executeRawUnsafe(
      ok
        ? `UPDATE dev_transactions SET status = 'successful', completed_at = now(), updated_at = now() WHERE id = $1::uuid AND status = 'pending'`
        : `UPDATE dev_transactions SET status = 'failed', failure_code = $2, failure_message = $3, completed_at = now(), updated_at = now() WHERE id = $1::uuid AND status = 'pending'`,
      txId,
      ...(ok ? [] : [failure!.code, failure!.message]),
    );
    if (done && legs.length) await applyLegs(db, scope, txId, "USD", legs);
    const row = (await getTransaction(db, scope, txId))!;
    if (done && ok && event) eventId = await recordEvent(db, { accountId: scope.accountId, mode: scope.mode, type: event, object: transactionObject(row) });
    return row;
  }, MONEY_TX);
  if (eventId) deliverSoon([eventId]);
  return tx;
}

export async function fundDevCard(ctx: ApiContext<z.infer<typeof cardMoveSchema>>, cardPublicId: string, initiatorIp: string | null): Promise<HandlerResult> {
  const b = ctx.body;
  const cardId = resolveId("card", cardPublicId, "id", "card");
  const amount = BigInt(b.amount);

  return runIdempotent(ctx, { card: cardId, ...b }, {
    replay: async (id) => {
      const tx = (await getTransaction(prisma, ctx.scope, id))!;
      return { status: tx.status === "pending" ? 202 : 201, body: transactionObject(tx) };
    },
    work: async (complete) => {
      await assertCardsOpen(ctx.mode);
      const card = usableCard(await getCardRow(ctx.scope, cardId));
      const min = await minCardFundCents();
      if (amount < min) throw new V1Error(400, `A card top-up is at least ${min} cents.`, "validation_error", "amount");
      const fee = cardFundFeeFor(ctx.plan, amount);
      const limits = ctx.mode === "live" ? effectiveLimits(ctx.account, await getDevLimits()) : null;
      const isTest = ctx.mode === "test";

      let eventId: string | null = null;
      let txId: string;
      try {
        txId = await prisma.$transaction(async (db) => {
          const wallet = await cardWallet(db, ctx.scope, card.customer_id, b.wallet_id);
          if (limits) await assertWithinOutflowLimits(db, ctx.account, "USD", amount + fee, limits);
          const id = await insertTransaction(db, {
            accountId: ctx.scope.accountId,
            mode: ctx.scope.mode,
            kind: "card_funding",
            status: isTest ? "successful" : "pending",
            currency: "USD",
            amountMinor: amount,
            feeMinor: fee,
            walletId: wallet.id,
            customerId: card.customer_id,
            reference: b.reference ?? null,
            metadata: b.metadata ?? {},
            details: { card_id: toPublicId("card", card.id) },
            initiatorIp,
          });
          await applyLegs(db, ctx.scope, id, "USD", [
            { walletId: wallet.id, amountMinor: -amount, kind: "card_funding" },
            { walletId: wallet.id, amountMinor: -fee, kind: "fee" },
          ]);
          if (isTest) {
            await db.$executeRawUnsafe(`UPDATE dev_cards SET balance_minor = balance_minor + $2, updated_at = now() WHERE id = $1::uuid`, card.id, amount);
          }
          await complete(db, "transaction", id, isTest ? 201 : 202);
          if (isTest) {
            eventId = await recordEvent(db, { accountId: ctx.scope.accountId, mode: ctx.scope.mode, type: "card.funded", object: transactionObject((await getTransaction(db, ctx.scope, id))!) });
          }
          return id;
        }, MONEY_TX);
      } catch (err) {
        if (uniqueViolation(err)?.includes("reference")) throw new V1Error(409, "Another transaction already uses this reference.", "duplicate_reference", "reference");
        throw err;
      }
      if (isTest) {
        if (eventId) deliverSoon([eventId]);
        return { status: 201, body: transactionObject((await getTransaction(prisma, ctx.scope, txId))!) };
      }

      try {
        await fundCard(card.provider_card_id!, Number(amount));
      } catch (err) {
        if (isDefiniteRejection(err)) {
          const tx = (await getTransaction(prisma, ctx.scope, txId))!;
          const failed = await settleMovement(
            txId,
            ctx.scope,
            false,
            [
              { walletId: tx.wallet_id!, amountMinor: amount, kind: "card_refund" },
              { walletId: tx.wallet_id!, amountMinor: fee, kind: "fee_refund" },
            ],
            null,
            { code: "card_fund_refused", message: "The card issuer refused this top-up. The amount and fee were returned to the wallet." },
          );
          return { status: 201, body: transactionObject(failed) };
        }
        console.error("[devapi] card top-up outcome unknown — left pending", { transaction: txId, error: err instanceof Error ? err.message : String(err) });
        await alertOpsOnce(
          `devapi-card-fund-unknown:${txId}`,
          "⚠️ Developer API: a live card top-up got no clear answer from the issuer. It is pending (the wallet was debited); check the card's balance and settle or refund it by hand.",
          { developer_account: ctx.scope.accountId, card: toPublicId("card", card.id) },
        );
        return { status: 202, body: transactionObject((await getTransaction(prisma, ctx.scope, txId))!) };
      }
      const done = await settleMovement(txId, ctx.scope, true, [], "card.funded");
      return { status: 201, body: transactionObject(done) };
    },
  });
}

export async function withdrawDevCard(ctx: ApiContext<z.infer<typeof cardMoveSchema>>, cardPublicId: string, initiatorIp: string | null): Promise<HandlerResult> {
  const b = ctx.body;
  const cardId = resolveId("card", cardPublicId, "id", "card");
  const amount = BigInt(b.amount);

  return runIdempotent(ctx, { card: cardId, ...b }, {
    replay: async (id) => {
      const tx = (await getTransaction(prisma, ctx.scope, id))!;
      return { status: tx.status === "pending" ? 202 : 201, body: transactionObject(tx) };
    },
    work: async (complete) => {
      await assertCardsOpen(ctx.mode);
      const card = usableCard(await getCardRow(ctx.scope, cardId));
      const isTest = ctx.mode === "test";

      let eventId: string | null = null;
      let txId: string;
      let walletId: string;
      try {
        ({ txId, walletId } = await prisma.$transaction(async (db) => {
          const wallet = await cardWallet(db, ctx.scope, card.customer_id, b.wallet_id);
          if (isTest) {
            const took = await db.$executeRawUnsafe(
              `UPDATE dev_cards SET balance_minor = balance_minor - $2, updated_at = now() WHERE id = $1::uuid AND balance_minor >= $2`,
              card.id,
              amount,
            );
            if (!took) throw new V1Error(422, "The card doesn't hold that much.", "insufficient_funds", "amount");
          }
          // Recorded before the issuer is asked, so a retry can't take money off the card twice.
          const id = await insertTransaction(db, {
            accountId: ctx.scope.accountId,
            mode: ctx.scope.mode,
            kind: "card_withdrawal",
            status: isTest ? "successful" : "pending",
            currency: "USD",
            amountMinor: amount,
            walletId: wallet.id,
            customerId: card.customer_id,
            reference: b.reference ?? null,
            metadata: b.metadata ?? {},
            details: { card_id: toPublicId("card", card.id) },
            initiatorIp,
          });
          if (isTest) await applyLegs(db, ctx.scope, id, "USD", [{ walletId: wallet.id, amountMinor: amount, kind: "card_withdrawal" }]);
          await complete(db, "transaction", id, isTest ? 201 : 202);
          if (isTest) {
            eventId = await recordEvent(db, { accountId: ctx.scope.accountId, mode: ctx.scope.mode, type: "card.withdrawn", object: transactionObject((await getTransaction(db, ctx.scope, id))!) });
          }
          return { txId: id, walletId: wallet.id };
        }, MONEY_TX));
      } catch (err) {
        if (uniqueViolation(err)?.includes("reference")) throw new V1Error(409, "Another transaction already uses this reference.", "duplicate_reference", "reference");
        throw err;
      }
      if (isTest) {
        if (eventId) deliverSoon([eventId]);
        return { status: 201, body: transactionObject((await getTransaction(prisma, ctx.scope, txId))!) };
      }

      try {
        await withdrawFromCard(card.provider_card_id!, Number(amount));
      } catch (err) {
        if (isDefiniteRejection(err)) {
          const failed = await settleMovement(txId, ctx.scope, false, [], null, {
            code: "card_withdraw_refused",
            message: "The card issuer refused this withdrawal (often: the card doesn't hold that much). Nothing moved.",
          });
          return { status: 201, body: transactionObject(failed) };
        }
        console.error("[devapi] card withdrawal outcome unknown — left pending", { transaction: txId, error: err instanceof Error ? err.message : String(err) });
        await alertOpsOnce(
          `devapi-card-withdraw-unknown:${txId}`,
          "⚠️ Developer API: a live card withdrawal got no clear answer from the issuer. Nothing was credited; check the card's balance and credit the wallet or fail it by hand.",
          { developer_account: ctx.scope.accountId, card: toPublicId("card", card.id) },
        );
        return { status: 202, body: transactionObject((await getTransaction(prisma, ctx.scope, txId))!) };
      }
      const done = await settleMovement(txId, ctx.scope, true, [{ walletId, amountMinor: amount, kind: "card_withdrawal" }], "card.withdrawn");
      return { status: 201, body: transactionObject(done) };
    },
  });
}

// ---------------------------------------------------------------------------
// Freeze

export async function setCardFrozen(ctx: ApiContext, cardPublicId: string, frozen: boolean): Promise<HandlerResult> {
  const cardId = resolveId("card", cardPublicId, "id", "card");
  await assertCardsOpen(ctx.mode);
  const card = await getCardRow(ctx.scope, cardId);
  if (!card) throw new V1Error(404, "No such card.", "not_found", "id");
  if (card.status === "pending" || card.status === "failed") throw new V1Error(409, "This card isn't active.", "card_not_active");
  if ((card.status === "frozen") === frozen) return { body: cardObject(card) };

  if (ctx.mode === "live") {
    try {
      await (frozen ? freezeCard : unfreezeCard)(card.provider_card_id!);
    } catch {
      throw new V1Error(503, "The card issuer didn't respond. Nothing changed; retry shortly.", "service_unavailable");
    }
  }
  let eventId: string | null = null;
  const updated = await prisma.$transaction(async (db) => {
    const rows = await db.$queryRawUnsafe<CardRow[]>(
      `UPDATE dev_cards SET status = $2, updated_at = now() WHERE id = $1::uuid AND status = $3 RETURNING *`,
      card.id,
      frozen ? "frozen" : "active",
      frozen ? "active" : "frozen",
    );
    const c = rows[0] ?? (await cardById(db, card.id))!;
    if (rows[0]) eventId = await recordEvent(db, { accountId: c.account_id, mode: c.mode, type: frozen ? "card.frozen" : "card.unfrozen", object: cardObject(c) });
    return c;
  });
  if (eventId) deliverSoon([eventId]);
  await recordDevAudit({ accountId: ctx.scope.accountId, actor: `key:${ctx.key.id}`, action: frozen ? "card.frozen" : "card.unfrozen", target: toPublicId("card", card.id), ip: ctx.ip });
  return { body: cardObject(updated) };
}

// ---------------------------------------------------------------------------
// Reading

export async function retrieveCard(ctx: ApiContext, cardPublicId: string): Promise<HandlerResult> {
  const cardId = resolveId("card", cardPublicId, "id", "card");
  const card = await getCardRow(ctx.scope, cardId);
  if (!card) throw new V1Error(404, "No such card.", "not_found", "id");
  let balance: number | null = null;
  if (ctx.mode === "live" && card.provider_card_id && card.status !== "failed") {
    try {
      const detail = await getCard(card.provider_card_id, { retries: 1 });
      balance = Number.isInteger(detail.balance) ? Number(detail.balance) : null;
    } catch {
      balance = null;
    }
  }
  return { body: cardObject(card, balance) };
}

export async function listDevCards(scope: Scope, q: URLSearchParams) {
  const limit = Math.min(100, Math.max(1, Number(q.get("limit") ?? 20) || 20));
  const customer = q.get("customer_id");
  const customerId = customer ? resolveId("customer", customer, "customer_id", "customer") : null;
  const after = q.get("starting_after");
  const afterId = after ? resolveId("card", after, "starting_after", "card") : null;
  const rows = await prisma.$queryRawUnsafe<CardRow[]>(
    `SELECT * FROM dev_cards c WHERE c.account_id = $1::uuid AND c.mode = $2
        AND ($3::uuid IS NULL OR c.customer_id = $3::uuid)
        AND ($4::uuid IS NULL OR (c.created_at, c.id) < (SELECT x.created_at, x.id FROM dev_cards x WHERE x.id = $4::uuid AND x.account_id = $1::uuid AND x.mode = $2))
      ORDER BY c.created_at DESC, c.id DESC LIMIT $5`,
    scope.accountId,
    scope.mode,
    customerId,
    afterId,
    limit + 1,
  );
  return { object: "list", data: rows.slice(0, limit).map((c) => cardObject(c)), has_more: rows.length > limit };
}

/** The full number, CVV and expiry. Never stored, capped per card per hour, every reveal recorded. */
export async function revealCard(ctx: ApiContext, cardPublicId: string): Promise<HandlerResult> {
  const cardId = resolveId("card", cardPublicId, "id", "card");
  const card = await getCardRow(ctx.scope, cardId);
  if (!card) throw new V1Error(404, "No such card.", "not_found", "id");
  if (card.status === "pending" || card.status === "failed" || !card.provider_card_id) {
    throw new V1Error(409, "This card isn't issued.", "card_not_active");
  }
  const allowed = await prisma.$transaction(async (db) => {
    await db.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, `devreveal:${card.id}`);
    const n = await db.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*)::bigint AS n FROM dev_card_reveals WHERE card_id = $1::uuid AND created_at > now() - interval '1 hour'`,
      card.id,
    );
    if (Number(n[0]?.n ?? 0) >= REVEALS_PER_HOUR) return false;
    await db.$executeRawUnsafe(`INSERT INTO dev_card_reveals (card_id, key_id, ip) VALUES ($1::uuid, $2::uuid, $3)`, card.id, ctx.key.id, ctx.ip);
    return true;
  });
  if (!allowed) {
    throw new V1Error(429, `A card's details can be shown ${REVEALS_PER_HOUR} times an hour. Try again later.`, "rate_limited", null, 600);
  }
  await recordDevAudit({ accountId: ctx.scope.accountId, actor: `key:${ctx.key.id}`, action: "card.details_revealed", target: toPublicId("card", card.id), ip: ctx.ip });

  let number: string | null;
  let cvv: string | null;
  let month = card.expiry_month;
  let year = card.expiry_year;
  if (ctx.mode === "test") {
    number = `424242424242${card.last4 ?? "4242"}`;
    cvv = "123";
  } else {
    let detail;
    try {
      detail = await getCard(card.provider_card_id);
    } catch {
      throw new V1Error(503, "The card issuer didn't respond. Retry shortly.", "service_unavailable");
    }
    number = typeof detail.card_number === "string" ? detail.card_number.replace(/\D/g, "") : null;
    cvv = typeof detail.cvv === "string" ? detail.cvv : null;
    const exp = parseExpiry(detail.expiry);
    if (exp) [month, year] = exp;
  }
  return {
    body: { object: "card_details", card_id: toPublicId("card", card.id), number, cvv, expiry_month: month, expiry_year: year },
    headers: { "cache-control": "no-store" },
  };
}

export async function listCardTransactions(ctx: ApiContext, cardPublicId: string): Promise<HandlerResult> {
  const cardId = resolveId("card", cardPublicId, "id", "card");
  const card = await getCardRow(ctx.scope, cardId);
  if (!card) throw new V1Error(404, "No such card.", "not_found", "id");
  const limit = Math.min(100, Math.max(1, Number(ctx.query.get("limit") ?? 20) || 20));
  if (ctx.mode === "test") {
    const rows = await prisma.$queryRawUnsafe<
      { id: string; amount_minor: bigint; type: string; status: string; description: string | null; merchant_name: string | null; decline_reason: string | null; created_at: Date }[]
    >(`SELECT * FROM dev_card_transactions WHERE card_id = $1::uuid ORDER BY created_at DESC LIMIT $2`, card.id, limit);
    return {
      body: {
        object: "list",
        has_more: false,
        data: rows.map((r) => ({
          object: "card_transaction",
          id: `ctxn_${r.id.replace(/-/g, "")}`,
          card_id: toPublicId("card", card.id),
          type: r.type,
          status: r.status,
          amount: Number(r.amount_minor),
          currency: "USD",
          description: r.description,
          merchant: r.merchant_name ? { name: r.merchant_name, city: null, country: null } : null,
          decline_reason: r.decline_reason,
          created_at: r.created_at.toISOString(),
        })),
      },
    };
  }
  if (!card.provider_card_id) return { body: { object: "list", data: [], has_more: false } };
  let rows;
  try {
    rows = await getCardTransactions(card.provider_card_id, { pageSize: limit });
  } catch {
    throw new V1Error(503, "The card issuer didn't respond. Retry shortly.", "service_unavailable");
  }
  return {
    body: {
      object: "list",
      has_more: false,
      data: rows.slice(0, limit).map((r) => ({
        object: "card_transaction",
        id: `ctxn_${String(r.id).replace(/[^A-Za-z0-9]/g, "").slice(0, 40)}`,
        card_id: toPublicId("card", card.id),
        type: String(r.entry ?? "").toUpperCase() === "CREDIT" ? "credit" : "debit",
        status: String(r.status ?? "").toLowerCase() || null,
        amount: Number(r.amount),
        currency: r.currency ?? "USD",
        description: typeof r.description === "string" ? r.description.slice(0, 200) : null,
        merchant: r.merchant ? { name: r.merchant.name ?? null, city: r.merchant.city ?? null, country: r.merchant.country ?? null } : null,
        decline_reason: null,
        created_at: r.created_at ?? null,
      })),
    },
  };
}

// ---------------------------------------------------------------------------
// Sandbox

/** Test mode: spend on a card. Approved if it's active and holds enough; otherwise recorded as declined. */
export async function simulatePurchase(scope: Scope, cardPublicId: string, amount: bigint, merchant: string | undefined) {
  const cardId = resolveId("card", cardPublicId, "id", "card");
  const card = await getCardRow(scope, cardId);
  if (!card || scope.mode !== "test") throw new V1Error(404, "No such card.", "not_found", "id");
  if (card.status === "pending" || card.status === "failed") throw new V1Error(409, "This card isn't issued.", "card_not_active");
  const id = randomUUID();
  const row = await prisma.$transaction(async (db) => {
    let status: "approved" | "declined" = "declined";
    let reason: string | null = card.status === "frozen" ? "card_frozen" : null;
    if (!reason) {
      const took = await db.$executeRawUnsafe(
        `UPDATE dev_cards SET balance_minor = balance_minor - $2, updated_at = now() WHERE id = $1::uuid AND status = 'active' AND balance_minor >= $2`,
        card.id,
        amount,
      );
      if (took) status = "approved";
      else reason = "insufficient_funds";
    }
    await db.$executeRawUnsafe(
      `INSERT INTO dev_card_transactions (id, card_id, amount_minor, type, status, description, merchant_name, decline_reason)
       VALUES ($1::uuid, $2::uuid, $3, 'debit', $4, $5, $6, $7)`,
      id,
      card.id,
      amount,
      status,
      `Purchase at ${merchant ?? "Test Merchant"}`,
      merchant ?? "Test Merchant",
      reason,
    );
    return { status, reason };
  });
  return {
    object: "card_transaction",
    id: `ctxn_${id.replace(/-/g, "")}`,
    card_id: toPublicId("card", card.id),
    type: "debit",
    status: row.status,
    amount: Number(amount),
    currency: "USD",
    description: `Purchase at ${merchant ?? "Test Merchant"}`,
    merchant: { name: merchant ?? "Test Merchant", city: null, country: null },
    decline_reason: row.reason,
    created_at: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Safety net

/**
 * Cards still pending a few minutes after the request: ask the issuer by the
 * creation reference and activate those it confirms. A card is never failed on
 * silence (the issuer may still create it), only reported to ops after an hour.
 * Never throws.
 */
export async function sweepPendingCards(opts: { olderThanMs?: number; limit?: number; now?: Date } = {}): Promise<{ checked: number; activated: number }> {
  const now = opts.now ?? new Date();
  try {
    const rows = await prisma.$queryRawUnsafe<CardRow[]>(
      `SELECT * FROM dev_cards WHERE mode = 'live' AND status = 'pending' AND created_at < $1 ORDER BY created_at ASC LIMIT $2`,
      new Date(now.getTime() - (opts.olderThanMs ?? 5 * 60_000)),
      opts.limit ?? 20,
    );
    let activated = 0;
    for (const c of rows) {
      const ageMs = now.getTime() - c.created_at.getTime();
      if (c.creation_ref) {
        try {
          const d = await getCard(c.creation_ref, { retries: 1 });
          if (d?.id && /^(ACTIVE|SUCCESS|SUCCESSFUL)$/i.test(String(d.status ?? "ACTIVE"))) {
            if (await activateCard(c.id, { providerCardId: d.id, maskedPan: d.masked_pan, expiry: d.expiry, brand: d.issuer })) activated += 1;
            continue;
          }
        } catch {
          // Not visible yet, or the issuer is down: try again next time.
        }
      }
      if (ageMs > 60 * 60_000) {
        await alertOpsOnce(
          `devapi-card-stuck:${c.id}`,
          "⚠️ Developer API: a live card has been pending for over an hour. Check the issuer, then activate it or refund it by hand.",
          { developer_account: c.account_id, card: toPublicId("card", c.id) },
        );
      }
    }
    return { checked: rows.length, activated };
  } catch (err) {
    console.error("[devapi] card sweep failed", err);
    return { checked: 0, activated: 0 };
  }
}
