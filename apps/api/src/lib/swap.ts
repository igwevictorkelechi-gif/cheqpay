import {
  Asset,
  Prisma,
  type Quote,
  TransactionStatus,
  TransactionType,
  prisma,
} from "@cheqpay/db";
import { ApiError } from "./http";
import { isWithinSingleTxLimit } from "./kyc";
import { fromMinorUnits } from "./money";
import { notifyUser } from "./alerts";
import {
  classifySwap,
  computeCryptoConvert,
  computeSwap,
  cryptoToNgnKobo,
  fiatUsdtPrice,
  isNgnUsdPair,
  type SwapSide,
} from "./rates";
import { getSwapSpreadBps, getUsdtNgnRate } from "./settings";
import { awardCashback } from "./cashback";
import { ensureUsdAsset } from "./ensureUsdAsset";
import { ensureQuoteProviderRef } from "./ensureQuoteProviderRef";
import { exchangeFx, quoteFx } from "./maplerad/fx";
import type { FxCurrency } from "./maplerad/types";
import { getPriceFeed, type PriceFeed } from "@/market";

/** The internal Asset for a fiat leg maps 1:1 to Maplerad's FX currency code. */
function fxCurrencyOf(asset: Asset): FxCurrency {
  return asset === Asset.USD ? "USD" : "NGN";
}

/**
 * USDT price for any convertible asset: the pegged fiat value for NGN/USD, or
 * the market spot for a crypto asset.
 */
function usdtPriceForAsset(
  asset: Asset,
  feed: PriceFeed,
  usdtNgnRate: Prisma.Decimal
): Promise<Prisma.Decimal> {
  const fiat = fiatUsdtPrice(asset, usdtNgnRate);
  return fiat !== null ? Promise.resolve(fiat) : feed.getSpotUsdt(asset);
}

export const QUOTE_TTL_MS = 45_000;

/**
 * Create a server-issued quote with a short TTL. Price comes from the feed,
 * the NGN rate + spread from the admin-controlled settings. The client never
 * sets the rate.
 */
export async function createQuote(params: {
  userId: string;
  tier: number;
  side: SwapSide;
  cryptoAsset: Asset; // BTC | USDT
  amountInMinor: bigint;
}) {
  const usdtNgnRate = await getUsdtNgnRate();
  if (usdtNgnRate === null) {
    throw new ApiError(503, "USDT→NGN rate not configured by admin", "no_rate");
  }
  const spreadBps = await getSwapSpreadBps();
  const cryptoUsdtPrice = await getPriceFeed().getSpotUsdt(params.cryptoAsset);

  const { amountOutMinor, rate } = computeSwap({
    side: params.side,
    cryptoAsset: params.cryptoAsset,
    amountInMinor: params.amountInMinor,
    cryptoUsdtPrice,
    usdtNgnRate: new Prisma.Decimal(usdtNgnRate),
    spreadBps,
  });

  const fromAsset = params.side === "buy" ? Asset.NGN : params.cryptoAsset;
  const toAsset = params.side === "buy" ? params.cryptoAsset : Asset.NGN;

  // Enforce the tier single-tx limit on the NGN leg.
  const ngnLegMinor = params.side === "buy" ? params.amountInMinor : amountOutMinor;
  if (!isWithinSingleTxLimit(params.tier, ngnLegMinor)) {
    throw new ApiError(403, "Amount exceeds your per-transaction limit", "single_tx_limit");
  }

  return prisma.quote.create({
    data: {
      userId: params.userId,
      fromAsset,
      toAsset,
      rate,
      amountIn: params.amountInMinor,
      amountOut: amountOutMinor,
      expiresAt: new Date(Date.now() + QUOTE_TTL_MS),
    },
  });
}

/**
 * Create a convert quote between any two supported assets (crypto↔crypto, or
 * anything touching USD — including NGN↔USD). Priced from each asset's USDT
 * value (fiats pegged, crypto from the feed) with the business spread applied
 * once. The NGN value of the input is used only to enforce the tier single-tx
 * limit.
 */
export async function createConvertQuote(params: {
  userId: string;
  tier: number;
  fromAsset: Asset;
  toAsset: Asset;
  amountInMinor: bigint;
}) {
  if (params.fromAsset === params.toAsset) {
    throw new ApiError(422, "Cannot convert an asset to itself", "same_asset");
  }

  // NGN↔USD settles on Maplerad's real FX rail, so it is priced from a live
  // Maplerad quote (whose reference we keep to settle at execute time) rather
  // than the synthetic USDT peg. Maplerad's rate is passed through as-is.
  if (isNgnUsdPair(params.fromAsset, params.toAsset)) {
    return createFxConvertQuote(params);
  }

  const usdtNgnRate = await getUsdtNgnRate();
  if (usdtNgnRate === null) {
    throw new ApiError(503, "USDT→NGN rate not configured by admin", "no_rate");
  }
  const usdtNgnDecimal = new Prisma.Decimal(usdtNgnRate);
  const spreadBps = await getSwapSpreadBps();
  const feed = getPriceFeed();
  const [fromUsdtPrice, toUsdtPrice] = await Promise.all([
    usdtPriceForAsset(params.fromAsset, feed, usdtNgnDecimal),
    usdtPriceForAsset(params.toAsset, feed, usdtNgnDecimal),
  ]);

  const { amountOutMinor, rate } = computeCryptoConvert({
    fromAsset: params.fromAsset,
    toAsset: params.toAsset,
    amountInMinor: params.amountInMinor,
    fromUsdtPrice,
    toUsdtPrice,
    spreadBps,
  });

  // Enforce the tier single-tx limit on the NGN value of the input leg.
  const ngnValueKobo = cryptoToNgnKobo(
    params.amountInMinor,
    params.fromAsset,
    fromUsdtPrice,
    usdtNgnDecimal
  );
  if (!isWithinSingleTxLimit(params.tier, ngnValueKobo)) {
    throw new ApiError(403, "Amount exceeds your per-transaction limit", "single_tx_limit");
  }

  // A USD leg needs the Asset enum value to exist for the typed Quote write.
  if (params.fromAsset === Asset.USD || params.toAsset === Asset.USD) {
    await ensureUsdAsset();
  }

  return prisma.quote.create({
    data: {
      userId: params.userId,
      fromAsset: params.fromAsset,
      toAsset: params.toAsset,
      rate,
      amountIn: params.amountInMinor,
      amountOut: amountOutMinor,
      expiresAt: new Date(Date.now() + QUOTE_TTL_MS),
    },
  });
}

/**
 * Price a NGN↔USD convert from a live Maplerad FX quote and persist it with the
 * provider reference, so executeSwap can settle the very same quote. The tier
 * single-tx limit is enforced on the NGN leg (input when selling NGN, output
 * when buying it).
 */
async function createFxConvertQuote(params: {
  userId: string;
  tier: number;
  fromAsset: Asset;
  toAsset: Asset;
  amountInMinor: bigint;
}) {
  // Maplerad's amount is the minor unit of the source currency, which is exactly
  // our minor unit for NGN (kobo) and USD (cents).
  const fx = await quoteFx({
    sourceCurrency: fxCurrencyOf(params.fromAsset),
    targetCurrency: fxCurrencyOf(params.toAsset),
    amount: Number(params.amountInMinor),
  });

  const amountOutMinor = BigInt(fx.target.amount);
  const ngnLegMinor = params.fromAsset === Asset.NGN ? params.amountInMinor : amountOutMinor;
  if (!isWithinSingleTxLimit(params.tier, ngnLegMinor)) {
    throw new ApiError(403, "Amount exceeds your per-transaction limit", "single_tx_limit");
  }

  // The USD enum value and the provider_ref column must exist for the typed write.
  await Promise.all([ensureUsdAsset(), ensureQuoteProviderRef()]);

  return prisma.quote.create({
    data: {
      userId: params.userId,
      fromAsset: params.fromAsset,
      toAsset: params.toAsset,
      rate: new Prisma.Decimal(fx.rate),
      amountIn: params.amountInMinor,
      amountOut: amountOutMinor,
      providerRef: fx.reference,
      expiresAt: new Date(Date.now() + QUOTE_TTL_MS),
    },
  });
}

/**
 * Execute a quote against treasury inventory: debit the from-asset, credit the
 * to-asset, atomically and idempotently. Quote must be unexpired, unconsumed,
 * and owned by the caller.
 */
export async function executeSwap(params: {
  userId: string;
  quoteId: string;
  idempotencyKey: string;
}) {
  const quote = await prisma.quote.findUnique({ where: { id: params.quoteId } });
  if (!quote || quote.userId !== params.userId) {
    throw new ApiError(404, "Quote not found", "no_quote");
  }
  if (quote.consumed) {
    throw new ApiError(409, "Quote already used", "quote_consumed");
  }
  if (quote.expiresAt.getTime() <= Date.now()) {
    throw new ApiError(410, "Quote expired; request a new one", "quote_expired");
  }

  const existing = await prisma.transaction.findUnique({
    where: { idempotencyKey: params.idempotencyKey },
  });
  if (existing) {
    return { transactionId: existing.id, status: existing.status };
  }

  // NGN↔USD backed by a Maplerad FX quote settles through the real FX rail,
  // which involves an external call that cannot live inside a DB transaction.
  if (quote.providerRef && isNgnUsdPair(quote.fromAsset, quote.toAsset)) {
    return executeFxSwap({ ...params, quote });
  }

  // buy = NGN→crypto, sell = crypto→NGN, convert = everything else (crypto↔
  // crypto, and anything touching USD, including NGN↔USD).
  const kind = classifySwap(quote.fromAsset, quote.toAsset);
  const isConvert = kind === "convert";
  const side: SwapSide = kind === "buy" ? "buy" : "sell";
  // The "primary" leg names the Transaction. Buy is named by the crypto bought;
  // otherwise by the from-asset (unchanged for a crypto↔crypto convert or sell).
  const primaryAsset = kind === "buy" ? quote.toAsset : quote.fromAsset;
  const primaryAmountMinor = kind === "buy" ? quote.amountOut : quote.amountIn;

  // Defensive: a USD leg needs the Asset enum value present for the typed writes.
  if (quote.fromAsset === Asset.USD || quote.toAsset === Asset.USD) {
    await ensureUsdAsset();
  }

  const result = await prisma.$transaction(async (db) => {
    // Consume the quote (first writer wins).
    const consumed = await db.quote.updateMany({
      where: { id: quote.id, consumed: false },
      data: { consumed: true },
    });
    if (consumed.count !== 1) {
      throw new ApiError(409, "Quote already used", "quote_consumed");
    }

    // Debit the from-asset, refusing to overdraw.
    const debit = await db.balance.updateMany({
      where: {
        userId: params.userId,
        asset: quote.fromAsset,
        available: { gte: quote.amountIn },
      },
      data: { available: { decrement: quote.amountIn } },
    });
    if (debit.count !== 1) {
      throw new ApiError(422, `Insufficient ${quote.fromAsset} balance`, "insufficient_funds");
    }

    // Credit the to-asset.
    await db.balance.upsert({
      where: { userId_asset: { userId: params.userId, asset: quote.toAsset } },
      update: { available: { increment: quote.amountOut } },
      create: { userId: params.userId, asset: quote.toAsset, available: quote.amountOut },
    });

    const record = await db.transaction.create({
      data: {
        userId: params.userId,
        type: isConvert
          ? TransactionType.CONVERT
          : kind === "buy"
          ? TransactionType.BUY
          : TransactionType.SELL,
        asset: primaryAsset,
        amount: primaryAmountMinor,
        status: TransactionStatus.COMPLETED,
        idempotencyKey: params.idempotencyKey,
        quoteId: quote.id,
        metadata: {
          kind,
          side,
          fromAsset: quote.fromAsset,
          toAsset: quote.toAsset,
          amountIn: quote.amountIn.toString(),
          amountOut: quote.amountOut.toString(),
          rate: quote.rate.toString(),
        },
      },
    });

    await db.auditLog.create({
      data: {
        userId: params.userId,
        action: `swap.${kind}`,
        resourceType: "Transaction",
        resourceId: record.id,
        details: {
          fromAsset: quote.fromAsset,
          toAsset: quote.toAsset,
          amountIn: quote.amountIn.toString(),
          amountOut: quote.amountOut.toString(),
        },
      },
    });

    return { transactionId: record.id, status: record.status };
  });

  // Cashback on the NGN leg of a buy/sell. A crypto→crypto convert has no NGN
  // leg, so it earns nothing. Runs after commit — it opens its own transaction.
  if (!isConvert) {
    const ngnLeg = quote.fromAsset === Asset.NGN ? quote.amountIn : quote.amountOut;
    await awardCashback({
      userId: params.userId,
      source: "trade",
      baseNgnMinor: ngnLeg,
      sourceTransactionId: result.transactionId,
    });
  }

  // Trade confirmation (best-effort, after commit).
  const fmtNgn = (m: bigint) => `₦${fromMinorUnits(m, Asset.NGN)}`;
  const fmtCrypto = (m: bigint, a: Asset) => `${fromMinorUnits(m, a)} ${a}`;
  // Fiat-aware label for a convert leg: ₦/$ symbols, or "amount ASSET" for crypto.
  const fmtAsset = (m: bigint, a: Asset) =>
    a === Asset.NGN
      ? fmtNgn(m)
      : a === Asset.USD
      ? `$${fromMinorUnits(m, a)}`
      : fmtCrypto(m, a);
  let title: string;
  let body: string;
  if (isConvert) {
    title = "Conversion complete";
    body = `Converted ${fmtAsset(quote.amountIn, quote.fromAsset)} to ${fmtAsset(
      quote.amountOut,
      quote.toAsset
    )}.`;
  } else if (side === "buy") {
    title = "Purchase complete";
    body = `Bought ${fmtCrypto(quote.amountOut, primaryAsset)} for ${fmtNgn(quote.amountIn)}.`;
  } else {
    title = "Sale complete";
    body = `Sold ${fmtCrypto(quote.amountIn, primaryAsset)} for ${fmtNgn(quote.amountOut)}.`;
  }
  await notifyUser(params.userId, {
    category: "trades",
    title,
    body,
    data: { transactionId: result.transactionId },
  });

  return result;
}

/**
 * Settle a NGN↔USD convert on Maplerad's real FX rail.
 *
 * The exchange is an external, irreversible money movement, so it cannot sit
 * inside a DB transaction. The order is deliberate:
 *   1. reserve — consume the quote and debit the payer atomically (rolls back
 *      cleanly; nothing external has happened yet);
 *   2. settle — call Maplerad; on failure refund the reservation and surface a
 *      retryable error, because the money never moved;
 *   3. credit — bank the target and record the transaction. A failure here is
 *      an owed credit against a real exchange, not a lost debit, so it is logged
 *      for reconciliation rather than reversed.
 */
async function executeFxSwap(params: {
  userId: string;
  quoteId: string;
  idempotencyKey: string;
  quote: Quote;
}) {
  const { quote } = params;
  await ensureUsdAsset();

  // 1. Reserve.
  await prisma.$transaction(async (db) => {
    const consumed = await db.quote.updateMany({
      where: { id: quote.id, consumed: false },
      data: { consumed: true },
    });
    if (consumed.count !== 1) {
      throw new ApiError(409, "Quote already used", "quote_consumed");
    }
    const debit = await db.balance.updateMany({
      where: {
        userId: params.userId,
        asset: quote.fromAsset,
        available: { gte: quote.amountIn },
      },
      data: { available: { decrement: quote.amountIn } },
    });
    if (debit.count !== 1) {
      throw new ApiError(422, `Insufficient ${quote.fromAsset} balance`, "insufficient_funds");
    }
  });

  // 2. Settle at the provider (point of no return).
  try {
    await exchangeFx({ quoteReference: quote.providerRef as string });
  } catch (err) {
    // The exchange did not happen — undo the reservation so the payer is whole.
    await prisma.balance
      .update({
        where: { userId_asset: { userId: params.userId, asset: quote.fromAsset } },
        data: { available: { increment: quote.amountIn } },
      })
      .catch((refundErr) =>
        console.error(
          "[fx] refund after a failed exchange also failed — reconcile",
          { userId: params.userId, quoteId: quote.id, asset: quote.fromAsset, amount: quote.amountIn.toString() },
          refundErr,
        ),
      );
    throw new ApiError(502, "Currency exchange failed at the provider; you were not charged", "fx_failed");
  }

  // 3. Credit + record.
  let result: { transactionId: string; status: TransactionStatus };
  try {
    result = await prisma.$transaction(async (db) => {
      await db.balance.upsert({
        where: { userId_asset: { userId: params.userId, asset: quote.toAsset } },
        update: { available: { increment: quote.amountOut } },
        create: { userId: params.userId, asset: quote.toAsset, available: quote.amountOut },
      });
      const record = await db.transaction.create({
        data: {
          userId: params.userId,
          type: TransactionType.CONVERT,
          asset: quote.fromAsset,
          amount: quote.amountIn,
          status: TransactionStatus.COMPLETED,
          idempotencyKey: params.idempotencyKey,
          quoteId: quote.id,
          metadata: {
            kind: "convert",
            rail: "maplerad_fx",
            providerRef: quote.providerRef,
            fromAsset: quote.fromAsset,
            toAsset: quote.toAsset,
            amountIn: quote.amountIn.toString(),
            amountOut: quote.amountOut.toString(),
            rate: quote.rate.toString(),
          },
        },
      });
      await db.auditLog.create({
        data: {
          userId: params.userId,
          action: "swap.fx",
          resourceType: "Transaction",
          resourceId: record.id,
          details: {
            fromAsset: quote.fromAsset,
            toAsset: quote.toAsset,
            amountIn: quote.amountIn.toString(),
            amountOut: quote.amountOut.toString(),
            providerRef: quote.providerRef,
          },
        },
      });
      return { transactionId: record.id, status: record.status };
    });
  } catch (err) {
    console.error(
      "[fx] exchange settled but crediting the user failed — reconcile",
      {
        userId: params.userId,
        quoteId: quote.id,
        toAsset: quote.toAsset,
        amountOut: quote.amountOut.toString(),
        providerRef: quote.providerRef,
      },
      err,
    );
    throw new ApiError(
      500,
      "Exchange completed but your balance update failed; support has been notified.",
      "fx_credit_failed",
    );
  }

  // Confirmation (best-effort, after commit).
  const fmtFiat = (m: bigint, a: Asset) =>
    a === Asset.USD ? `$${fromMinorUnits(m, a)}` : `₦${fromMinorUnits(m, Asset.NGN)}`;
  await notifyUser(params.userId, {
    category: "trades",
    title: "Conversion complete",
    body: `Converted ${fmtFiat(quote.amountIn, quote.fromAsset)} to ${fmtFiat(
      quote.amountOut,
      quote.toAsset,
    )}.`,
    data: { transactionId: result.transactionId },
  });

  return result;
}
