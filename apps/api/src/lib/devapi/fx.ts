// apps/api/src/lib/devapi/fx.ts
//
// Converting between a developer's NGN and USD wallets (to fund USD cards from
// naira deposits, for example). Two steps, like the app's own convert:
//
//   quote       a price for an amount, good for 45 seconds, bound to the
//               account and mode that asked for it;
//   conversion  spends a quote, once, between two wallets of the same owner
//               (both main, or both the same customer's).
//
// Live conversions price and settle on the same exchange rail the app uses,
// with the same margin (settings → FX margins): the partner's quote, less our
// margin taken in the currency received. Settlement is an external,
// irreversible call, so the order matters:
//   1. reserve — spend the quote and debit the source wallet, atomically;
//   2. settle at the partner;
//   3. credit what actually settled, less the margin.
// A definite refusal at step 2 refunds the source wallet in full. An unclear
// outcome (timeout, 5xx) leaves the conversion pending for reconciliation —
// refunding then could pay twice if the exchange did happen.
//
// The sandbox uses fixed test rates and never calls the partner.

import { randomUUID } from "node:crypto";
import { Prisma, prisma } from "@cheqpay/db";
import { z } from "zod";
import { toPublicId } from "@cheqpay/devapi";
import { getFeatureFlags } from "../features";
import { exchangeFx, quoteFx } from "../maplerad/fx";
import { getProviderBalanceMinor } from "../maplerad/treasury";
import { isDefiniteRejection } from "../providerErrors";
import { feeFromBps, getFxSideMarginBps } from "../settings";
import { alertOpsOnce } from "../opsAlert";
import { V1Error, type ApiContext, type HandlerResult } from "./handler";
import { effectiveLimits, getDevLimits } from "./limits";
import { applyLegs, getTransaction, getWallet, insertTransaction, lockWallets } from "./ledger";
import { recordEvent } from "./events";
import { deliverSoon } from "./webhooks";
import { amountSchema, currencySchema, descriptionSchema, metadataSchema, referenceSchema, resolveId, uniqueViolation } from "./inputs";
import { runIdempotent } from "./idempotency";
import { transactionObject } from "./serialize";
import type { Currency, FxQuoteRow, Mode } from "./types";

const MONEY_TX = { maxWait: 10_000, timeout: 15_000 };
export const QUOTE_TTL_SECONDS = 45;

/** Sandbox rates, in naira per dollar: you buy dollars at the first, sell them at the second. */
export const SANDBOX_RATES = { ngnPerUsdBuy: 1_600, ngnPerUsdSell: 1_550 } as const;

export const quoteSchema = z
  .object({
    from_currency: currencySchema,
    to_currency: currencySchema,
    amount: amountSchema,
  })
  .strict()
  .refine((b) => b.from_currency !== b.to_currency, { message: "from_currency and to_currency must differ", path: ["to_currency"] });

export const conversionSchema = z
  .object({
    quote_id: z.string().max(80),
    from_wallet_id: z.string().max(80),
    to_wallet_id: z.string().max(80),
    reference: referenceSchema.optional(),
    description: descriptionSchema.optional(),
    metadata: metadataSchema.optional(),
  })
  .strict();

export function quoteObject(q: FxQuoteRow) {
  return {
    object: "fx_quote",
    id: toPublicId("quote", q.id),
    from_currency: q.from_currency,
    to_currency: q.to_currency,
    amount: Number(q.amount_minor),
    converted_amount: Number(q.net_out_minor),
    fee: Number(q.fee_minor),
    fee_currency: q.to_currency,
    rate: Number(q.rate),
    status: q.status === "used" ? "used" : q.expires_at <= new Date() ? "expired" : "open",
    expires_at: q.expires_at.toISOString(),
    livemode: q.mode === "live",
    created_at: q.created_at.toISOString(),
  };
}

async function getQuote(scope: { accountId: string; mode: Mode }, id: string): Promise<FxQuoteRow | null> {
  const rows = await prisma.$queryRawUnsafe<FxQuoteRow[]>(
    `SELECT * FROM dev_fx_quotes WHERE id = $1::uuid AND account_id = $2::uuid AND mode = $3`,
    id,
    scope.accountId,
    scope.mode,
  );
  return rows[0] ?? null;
}

/** Whole units of `to` per whole unit of `from`, from the amounts a quote actually gives. */
function displayRate(from: Currency, amountMinor: bigint, netOutMinor: bigint): string {
  const rate = new Prisma.Decimal(netOutMinor.toString()).div(new Prisma.Decimal(amountMinor.toString()));
  return rate.toDecimalPlaces(from === "NGN" ? 8 : 4).toString();
}

/** NGN->USD is us selling dollars; USD->NGN is us buying them (the app's naming). */
const sideFor = (from: Currency) => (from === "NGN" ? "sell_usd" : "buy_usd");

async function assertFxOpen(): Promise<void> {
  if (!(await getFeatureFlags()).crypto_trading) {
    throw new V1Error(503, "Conversions are temporarily unavailable.", "feature_disabled");
  }
}

export async function createQuote(ctx: ApiContext<z.infer<typeof quoteSchema>>): Promise<HandlerResult> {
  const b = ctx.body;
  const amount = BigInt(b.amount);
  return runIdempotent(ctx, b, {
    replay: async (id) => ({ status: 201, body: quoteObject((await getQuote(ctx.scope, id))!) }),
    work: async (complete) => {
      let grossOut: bigint;
      let providerRef: string | null = null;
      if (ctx.mode === "live") {
        await assertFxOpen();
        const limits = effectiveLimits(ctx.account, await getDevLimits());
        if (amount > limits.perTxnMax[b.from_currency]) {
          throw new V1Error(422, "That is over the largest single movement allowed on your account.", "limit_exceeded", "amount");
        }
        // The exchange is paid from our pooled balance in the source currency;
        // say so now rather than fail at conversion time.
        const held = await getProviderBalanceMinor(b.from_currency);
        if (held !== null && held < amount) {
          throw new V1Error(503, "Conversions are briefly limited. Try a smaller amount or retry shortly.", "service_unavailable");
        }
        let fx;
        try {
          fx = await quoteFx({ sourceCurrency: b.from_currency, targetCurrency: b.to_currency, amount: Number(amount) });
        } catch {
          throw new V1Error(503, "Conversions can't be priced right now. Nothing was charged; retry shortly.", "service_unavailable");
        }
        if (!Number.isInteger(fx?.target?.amount) || fx.target.amount <= 0 || !fx.reference) {
          throw new V1Error(503, "Conversions can't be priced right now. Nothing was charged; retry shortly.", "service_unavailable");
        }
        grossOut = BigInt(fx.target.amount);
        providerRef = fx.reference;
      } else {
        grossOut =
          b.from_currency === "NGN"
            ? amount / BigInt(SANDBOX_RATES.ngnPerUsdBuy) // kobo -> cents
            : amount * BigInt(SANDBOX_RATES.ngnPerUsdSell); // cents -> kobo
      }
      const marginBps = await getFxSideMarginBps(sideFor(b.from_currency));
      const fee = feeFromBps(grossOut, marginBps);
      const net = grossOut - fee;
      if (net <= 0n) throw new V1Error(422, "That amount is too small to convert.", "validation_error", "amount");

      const id = randomUUID();
      const row = await prisma.$transaction(async (db) => {
        const rows = await db.$queryRawUnsafe<FxQuoteRow[]>(
          `INSERT INTO dev_fx_quotes (id, account_id, mode, from_currency, to_currency, amount_minor, gross_out_minor, fee_minor,
             net_out_minor, rate, margin_bps, provider_ref, expires_at)
           VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10::numeric, $11, $12, now() + make_interval(secs => $13))
           RETURNING *`,
          id,
          ctx.scope.accountId,
          ctx.scope.mode,
          b.from_currency,
          b.to_currency,
          amount,
          grossOut,
          fee,
          net,
          displayRate(b.from_currency, amount, net),
          marginBps,
          providerRef,
          QUOTE_TTL_SECONDS,
        );
        await complete(db, "fx_quote", id, 201);
        return rows[0];
      });
      return { status: 201, body: quoteObject(row) };
    },
  });
}

export async function createConversion(ctx: ApiContext<z.infer<typeof conversionSchema>>, initiatorIp: string | null): Promise<HandlerResult> {
  const b = ctx.body;
  const quoteId = resolveId("quote", b.quote_id, "quote_id", "quote");
  const fromId = resolveId("wallet", b.from_wallet_id, "from_wallet_id", "wallet");
  const toId = resolveId("wallet", b.to_wallet_id, "to_wallet_id", "wallet");

  return runIdempotent(ctx, b, {
    replay: async (id) => {
      const tx = (await getTransaction(prisma, ctx.scope, id))!;
      return { status: tx.status === "pending" ? 202 : 201, body: transactionObject(tx) };
    },
    work: async (complete) => {
      if (ctx.mode === "live") await assertFxOpen();
      const [quote, from, to] = await Promise.all([
        getQuote(ctx.scope, quoteId),
        getWallet(prisma, ctx.scope, fromId),
        getWallet(prisma, ctx.scope, toId),
      ]);
      if (!quote) throw new V1Error(404, "No such quote.", "not_found", "quote_id");
      if (!from) throw new V1Error(404, "No such wallet.", "not_found", "from_wallet_id");
      if (!to) throw new V1Error(404, "No such wallet.", "not_found", "to_wallet_id");
      if (from.currency !== quote.from_currency) {
        throw new V1Error(400, `The quote converts from ${quote.from_currency}; that wallet holds ${from.currency}.`, "currency_mismatch", "from_wallet_id");
      }
      if (to.currency !== quote.to_currency) {
        throw new V1Error(400, `The quote converts to ${quote.to_currency}; that wallet holds ${to.currency}.`, "currency_mismatch", "to_wallet_id");
      }
      if (from.customer_id !== to.customer_id) {
        throw new V1Error(400, "Convert between two wallets of the same owner: both your main wallets, or both one customer's.", "validation_error", "to_wallet_id");
      }

      const details = {
        quote_id: toPublicId("quote", quote.id),
        to_currency: quote.to_currency,
        converted_amount: Number(quote.net_out_minor),
        fx_fee: Number(quote.fee_minor),
        rate: Number(quote.rate),
      };
      const isTest = ctx.mode === "test";
      let txId: string;
      let eventId: string | null = null;
      try {
        txId = await prisma.$transaction(async (db) => {
          // Spend the quote first: only one request can, and only before it expires.
          const spent = await db.$queryRawUnsafe<{ id: string }[]>(
            `UPDATE dev_fx_quotes SET status = 'used' WHERE id = $1::uuid AND status = 'open' AND expires_at > now() RETURNING id`,
            quote.id,
          );
          if (!spent.length) {
            const now = await db.$queryRawUnsafe<{ status: string }[]>(`SELECT status FROM dev_fx_quotes WHERE id = $1::uuid`, quote.id);
            if (now[0]?.status === "used") throw new V1Error(409, "This quote has already been used.", "quote_used", "quote_id");
            throw new V1Error(410, "This quote has expired. Request a new one.", "quote_expired", "quote_id");
          }
          await lockWallets(db, [from.id, to.id]);
          const id = await insertTransaction(db, {
            accountId: ctx.scope.accountId,
            mode: ctx.scope.mode,
            kind: "conversion",
            status: isTest ? "successful" : "pending",
            currency: quote.from_currency,
            amountMinor: quote.amount_minor,
            walletId: from.id,
            counterpartyWalletId: to.id,
            customerId: from.customer_id,
            reference: b.reference ?? null,
            description: b.description ?? null,
            metadata: b.metadata ?? {},
            details,
            providerRef: quote.provider_ref,
            initiatorIp,
          });
          await db.$executeRawUnsafe(`UPDATE dev_fx_quotes SET transaction_id = $2::uuid WHERE id = $1::uuid`, quote.id, id);
          await applyLegs(db, ctx.scope, id, quote.from_currency, [{ walletId: from.id, amountMinor: -quote.amount_minor, kind: "conversion_out" }]);
          if (isTest) {
            await applyLegs(db, ctx.scope, id, quote.to_currency, [{ walletId: to.id, amountMinor: quote.net_out_minor, kind: "conversion_in" }]);
          }
          await complete(db, "transaction", id, isTest ? 201 : 202);
          if (isTest) {
            const tx = (await getTransaction(db, ctx.scope, id))!;
            eventId = await recordEvent(db, { accountId: ctx.scope.accountId, mode: ctx.scope.mode, type: "conversion.completed", object: transactionObject(tx) });
          }
          return id;
        }, MONEY_TX);
      } catch (err) {
        if (uniqueViolation(err) === "dev_transactions_reference_uidx") {
          throw new V1Error(409, "Another transaction already uses this reference.", "duplicate_reference", "reference");
        }
        throw err;
      }

      if (isTest) {
        if (eventId) deliverSoon([eventId]);
        return { status: 201, body: transactionObject((await getTransaction(prisma, ctx.scope, txId))!) };
      }
      const settled = await settleLiveConversion(ctx.scope, txId, quote, { from: from.id, to: to.id });
      return { status: settled.status === "pending" ? 202 : 201, body: transactionObject(settled) };
    },
  });
}

type Wallets = { from: string; to: string };

async function settleLiveConversion(scope: { accountId: string; mode: Mode }, txId: string, quote: FxQuoteRow, wallets: Wallets) {
  let result;
  try {
    result = await exchangeFx({ quoteReference: quote.provider_ref! });
  } catch (err) {
    if (isDefiniteRejection(err)) return failConversion(scope, txId, quote, wallets);
    // Unknown outcome: the exchange may have happened. Hold, don't refund.
    console.error("[devapi] conversion outcome unknown — left pending for reconciliation", { transaction: txId });
    await alertOpsOnce(
      `devapi-fx-unknown:${txId}`,
      "⚠️ Developer API: a live conversion's outcome is unknown (the exchange call didn't answer). It is pending; check the exchange history and settle or refund it by hand.",
      { developer_account: scope.accountId, transaction: toPublicId("transaction", txId) },
    );
    return (await getTransaction(prisma, scope, txId))!;
  }

  // Credit what actually settled, less the same margin the quote used. When
  // the partner settles exactly what it quoted, this is the quoted amount.
  const settledGross = Number.isInteger(result?.target?.amount) && result.target.amount > 0 ? BigInt(result.target.amount) : null;
  const fee = settledGross === null ? quote.fee_minor : feeFromBps(settledGross, quote.margin_bps);
  const credit = settledGross === null ? quote.net_out_minor : settledGross - fee;

  let eventId: string | null = null;
  const tx = await prisma.$transaction(async (db) => {
    const done = await db.$executeRawUnsafe(
      `UPDATE dev_transactions SET status = 'successful', completed_at = now(), updated_at = now(),
          details = details || jsonb_build_object('converted_amount', $2::bigint, 'fx_fee', $3::bigint)
        WHERE id = $1::uuid AND status = 'pending'`,
      txId,
      credit,
      fee,
    );
    if (!done) return (await getTransaction(db, scope, txId))!;
    await applyLegs(db, scope, txId, quote.to_currency, [{ walletId: wallets.to, amountMinor: credit, kind: "conversion_in" }]);
    const row = (await getTransaction(db, scope, txId))!;
    eventId = await recordEvent(db, { accountId: scope.accountId, mode: scope.mode, type: "conversion.completed", object: transactionObject(row) });
    return row;
  }, MONEY_TX);
  if (eventId) deliverSoon([eventId]);
  return tx;
}

async function failConversion(scope: { accountId: string; mode: Mode }, txId: string, quote: FxQuoteRow, wallets: Wallets) {
  let eventId: string | null = null;
  const tx = await prisma.$transaction(async (db) => {
    const done = await db.$executeRawUnsafe(
      `UPDATE dev_transactions SET status = 'failed', failure_code = 'conversion_refused',
          failure_message = 'The exchange refused this conversion. The amount was returned to the wallet.',
          completed_at = now(), updated_at = now()
        WHERE id = $1::uuid AND status = 'pending'`,
      txId,
    );
    if (!done) return (await getTransaction(db, scope, txId))!;
    await applyLegs(db, scope, txId, quote.from_currency, [{ walletId: wallets.from, amountMinor: quote.amount_minor, kind: "conversion_refund" }]);
    const row = (await getTransaction(db, scope, txId))!;
    eventId = await recordEvent(db, { accountId: scope.accountId, mode: scope.mode, type: "conversion.failed", object: transactionObject(row) });
    return row;
  }, MONEY_TX);
  if (eventId) deliverSoon([eventId]);
  return tx;
}
