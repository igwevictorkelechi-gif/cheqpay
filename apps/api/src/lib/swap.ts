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
import { ASSET_DECIMALS, fromMinorUnits } from "./money";
import { notifyUser } from "./alerts";
import {
  classifySwap,
  computeCryptoConvert,
  computeSwap,
  cryptoToNgnKobo,
  fiatUsdtPrice,
  floorOutToMinMarginNgn,
  isNgnUsdPair,
  type SwapSide,
} from "./rates";
import {
  feeFromBps,
  getCryptoSettlement,
  getFxSideMarginBps,
  getMinTradeMarginNgn,
  getSwapSpreadBpsFor,
  getUsdtNgnRate,
  type FxSide,
} from "./settings";
import { awardCashback } from "./cashback";
import { ensureUsdAsset } from "./ensureUsdAsset";
import { ensureQuoteProviderRef } from "./ensureQuoteProviderRef";
import { exchangeFx, quoteFx } from "./maplerad/fx";
import { MapleradError } from "./maplerad/client";
import { alertOpsOnce } from "./opsAlert";
import { getProviderBalanceMinor } from "./maplerad/treasury";
import type { FxCurrency } from "./maplerad/types";
import { getPriceFeed, type PriceFeed } from "@/market";

/** Stablecoins, which Maplerad holds as dollars and pays out of the dollar wallet. */
function isStablecoin(asset: Asset): boolean {
  return asset === Asset.USDT || asset === Asset.USDC;
}

/** Maplerad's FX currency for a rail leg: naira, or dollars (a stablecoin is dollars there). */
function fxCurrencyOf(asset: Asset): FxCurrency {
  return asset === Asset.USD || isStablecoin(asset) ? "USD" : "NGN";
}

/**
 * Our minor units per Maplerad minor unit, for a rail leg. Maplerad counts in
 * kobo and cents, and a stablecoin in cents of its dollar wallet; we count a
 * stablecoin to 6 places, so one Maplerad cent is 10,000 of ours.
 */
function providerScale(asset: Asset): bigint {
  return isStablecoin(asset) ? 10n ** BigInt(ASSET_DECIMALS[asset] - ASSET_DECIMALS[Asset.USD]) : 1n;
}

/**
 * A naira ⇄ USDT/USDC pair. When crypto settlement is "maplerad", it is backed
 * by the naira ⇄ dollar exchange it amounts to at Maplerad, so the business
 * holds the dollars behind the stablecoin a customer buys.
 */
export function isNgnStablecoinPair(fromAsset: Asset, toAsset: Asset): boolean {
  return (
    (fromAsset === Asset.NGN && isStablecoin(toAsset)) ||
    (toAsset === Asset.NGN && isStablecoin(fromAsset))
  );
}

/** Pairs settled by a real exchange on Maplerad's FX rail. */
function settlesOnFxRail(fromAsset: Asset, toAsset: Asset): boolean {
  return isNgnUsdPair(fromAsset, toAsset) || isNgnStablecoinPair(fromAsset, toAsset);
}

/**
 * The spread kept on a rail exchange. NGN⇄USD has its own per-side FX margin;
 * a stablecoin buy or sell keeps the crypto buy/sell spread, so backing it at
 * Maplerad doesn't change which admin setting prices it.
 */
function railMarginBps(fromAsset: Asset, toAsset: Asset): Promise<number> {
  return isNgnUsdPair(fromAsset, toAsset)
    ? getFxSideMarginBps(fxSideFor(fromAsset))
    : getSwapSpreadBpsFor(classifySwap(fromAsset, toAsset));
}

const RAIL_LABEL: Partial<Record<Asset, string>> = {
  NGN: "naira",
  USD: "dollars",
  USDT: "USDT",
  USDC: "USDC",
};

/** "Converting naira to dollars isn't available right now. You can still convert dollars to naira." */
function directionUnavailable(from: Asset, to: Asset): string {
  if (from === Asset.NGN && isStablecoin(to)) {
    return `Buying ${to} with naira isn't available right now. You can still sell ${to} for naira.`;
  }
  if (to === Asset.NGN && isStablecoin(from)) {
    return `Selling ${from} for naira isn't available right now. You can still buy ${from} with naira.`;
  }
  return `Converting ${RAIL_LABEL[from]} to ${RAIL_LABEL[to]} isn't available right now. You can still convert ${RAIL_LABEL[to]} to ${RAIL_LABEL[from]}.`;
}

/**
 * Turn a refused FX quote into something the customer can act on. Left alone
 * it surfaced as a bare 500 "Internal server error". The live case: Maplerad
 * answers NGN -> USD with "NGN exchanges are not enabled for this business"
 * (an account setting on their side) while USD -> NGN works, so the message
 * says which direction still works. Ops hear about it once an hour.
 */
export function fxQuoteError(err: unknown, from: Asset, to: Asset): ApiError {
  if (err instanceof ApiError) return err;
  const message = err instanceof Error ? err.message : String(err);
  const status = err instanceof MapleradError ? err.status : 0;
  const pair = `${fxCurrencyOf(from)}→${fxCurrencyOf(to)}`;
  void alertOpsOnce(
    `fx-quote:${pair}:${/not enabled/i.test(message) ? "disabled" : "failed"}`,
    `⚠️ ${pair} conversions are failing at Maplerad: "${message}". ${
      /not enabled/i.test(message)
        ? "This is a setting on the Maplerad business account — ask Maplerad to enable NGN exchanges."
        : ""
    }`,
    { pair, reason: message.slice(0, 300) }
  );
  if (/not enabled/i.test(message)) {
    return new ApiError(503, `${directionUnavailable(from, to)} Nothing was charged.`, "fx_direction_unavailable");
  }
  return new ApiError(
    502,
    status >= 500 || status === 0
      ? "The exchange provider couldn't be reached. Please try again shortly — nothing was charged."
      : "The exchange provider couldn't price that conversion. Please try a different amount — nothing was charged.",
    "fx_quote_failed",
  );
}

/** Minor units -> whole units for an asset, as a Decimal. */
function toWhole(minor: bigint, asset: Asset): Prisma.Decimal {
  return new Prisma.Decimal(minor.toString()).div(
    new Prisma.Decimal(10).pow(ASSET_DECIMALS[asset]),
  );
}

/**
 * The rate for a pair of settled legs: TO whole units per 1 FROM whole unit.
 *
 * Maplerad returns a `rate` of its own, but nothing in the response says which
 * direction it is quoted in, and for NGN↔USD the two directions are ~1,550 and
 * ~0.00065 — an inverted rate is indistinguishable from a plausible one, so it
 * cannot be validated after the fact. The two legs are unambiguous, so the rate
 * is derived from them and always means what `rate` means on every other quote
 * in this codebase. That is the number the clients print as "1 X = Y".
 */
function rateFromLegs(
  fromAsset: Asset,
  amountInMinor: bigint,
  toAsset: Asset,
  amountOutMinor: bigint,
): Prisma.Decimal {
  const from = toWhole(amountInMinor, fromAsset);
  if (from.lte(0)) {
    throw new ApiError(422, "Amount must be positive", "bad_amount");
  }
  return toWhole(amountOutMinor, toAsset).div(from);
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
  // A stablecoin bought or sold for naira is backed at Maplerad: priced from a
  // live naira ⇄ dollar quote and settled by that exchange (see executeFxSwap).
  if (isStablecoin(params.cryptoAsset) && (await getCryptoSettlement()) === "maplerad") {
    return createFxConvertQuote({
      userId: params.userId,
      tier: params.tier,
      fromAsset: params.side === "buy" ? Asset.NGN : params.cryptoAsset,
      toAsset: params.side === "buy" ? params.cryptoAsset : Asset.NGN,
      amountInMinor: params.amountInMinor,
      ngnPerCryptoRate: true,
    });
  }

  const usdtNgnRate = await getUsdtNgnRate();
  if (usdtNgnRate === null) {
    throw new ApiError(503, "USDT→NGN rate not configured by admin", "no_rate");
  }
  const spreadBps = await getSwapSpreadBpsFor(params.side);
  const cryptoUsdtPrice = await getPriceFeed().getSpotUsdt(params.cryptoAsset);

  const usdtNgnDecimal = new Prisma.Decimal(usdtNgnRate);
  const { amountOutMinor: spreadOutMinor, rate } = computeSwap({
    side: params.side,
    cryptoAsset: params.cryptoAsset,
    amountInMinor: params.amountInMinor,
    cryptoUsdtPrice,
    usdtNgnRate: usdtNgnDecimal,
    spreadBps,
  });

  const fromAsset = params.side === "buy" ? Asset.NGN : params.cryptoAsset;
  const toAsset = params.side === "buy" ? params.cryptoAsset : Asset.NGN;

  // Keep at least a flat naira profit on top of the percentage spread. The
  // gross (zero-spread) payout is the mid value; the mid naira price of one
  // whole out unit is the crypto price for a buy (out = crypto) and 1 for a
  // sell (out = naira).
  const minMarginNgn = await getMinTradeMarginNgn();
  let amountOutMinor = spreadOutMinor;
  if (minMarginNgn > 0) {
    const { amountOutMinor: grossOutMinor } = computeSwap({
      side: params.side,
      cryptoAsset: params.cryptoAsset,
      amountInMinor: params.amountInMinor,
      cryptoUsdtPrice,
      usdtNgnRate: usdtNgnDecimal,
      spreadBps: 0,
    });
    amountOutMinor = floorOutToMinMarginNgn({
      grossOutMinor,
      netOutMinor: spreadOutMinor,
      outAsset: toAsset,
      ngnPerOutWhole: toAsset === Asset.NGN ? new Prisma.Decimal(1) : cryptoUsdtPrice.mul(usdtNgnDecimal),
      minMarginNgn,
    });
    if (amountOutMinor <= 0n) {
      throw new ApiError(422, "Amount too small to trade", "dust_amount");
    }
  }

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
  // than the synthetic USDT peg. The displayed rate is derived from the two
  // legs Maplerad returns, not from its own `rate` field — see rateFromLegs.
  if (isNgnUsdPair(params.fromAsset, params.toAsset)) {
    return createFxConvertQuote(params);
  }
  // Naira ⇄ stablecoin is backed at Maplerad too, when that is switched on.
  if (isNgnStablecoinPair(params.fromAsset, params.toAsset) && (await getCryptoSettlement()) === "maplerad") {
    return createFxConvertQuote(params);
  }

  const usdtNgnRate = await getUsdtNgnRate();
  if (usdtNgnRate === null) {
    throw new ApiError(503, "USDT→NGN rate not configured by admin", "no_rate");
  }
  const usdtNgnDecimal = new Prisma.Decimal(usdtNgnRate);
  // A convert that touches naira (crypto ⇄ NGN) is priced as the buy or sell it is.
  const spreadBps = await getSwapSpreadBpsFor(classifySwap(params.fromAsset, params.toAsset));
  const feed = getPriceFeed();
  const [fromUsdtPrice, toUsdtPrice] = await Promise.all([
    usdtPriceForAsset(params.fromAsset, feed, usdtNgnDecimal),
    usdtPriceForAsset(params.toAsset, feed, usdtNgnDecimal),
  ]);

  const { amountOutMinor, rate, feeOutMinor } = computeCryptoConvert({
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

  const quote = await prisma.quote.create({
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
  // The fee is for display only: execution settles the stored amountOut.
  return { ...quote, feeOutMinor, feeBps: spreadBps };
}

/**
 * Which side of the book a NGN⇄USD conversion puts us on.
 *
 * Naming is from the business's side: the user paying naira is buying dollars
 * from us, so that is our "sell_usd". Deriving it here rather than at each call
 * site keeps the quote and the settlement on the same side of the spread — they
 * must agree, or a conversion would be priced on one side and settled on the
 * other.
 */
function fxSideFor(fromAsset: Asset): FxSide {
  return fromAsset === Asset.NGN ? "sell_usd" : "buy_usd";
}

/**
 * Price a rail swap — NGN↔USD, or NGN↔USDT/USDC backed as NGN↔USD — from a live
 * Maplerad FX quote and persist it with the provider reference, so executeSwap
 * can settle the very same quote. The tier single-tx limit is enforced on the
 * NGN leg (input when selling NGN, output when buying it).
 *
 * `ngnPerCryptoRate` stores a stablecoin buy's rate as naira per coin, the way
 * buy and sell quotes are read by the apps; otherwise the rate is TO per FROM.
 */
async function createFxConvertQuote(params: {
  userId: string;
  tier: number;
  fromAsset: Asset;
  toAsset: Asset;
  amountInMinor: bigint;
  ngnPerCryptoRate?: boolean;
}) {
  // Maplerad counts the source in kobo or cents. A stablecoin amount finer
  // than a cent can't be exchanged, so it is trimmed off and stays with the
  // user; the quote is for what can actually be exchanged.
  const scaleIn = providerScale(params.fromAsset);
  const providerAmount = params.amountInMinor / scaleIn;
  const amountInMinor = providerAmount * scaleIn;
  if (providerAmount <= 0n) {
    throw new ApiError(422, "That amount is too small to convert", "amount_too_small");
  }

  // The exchange is paid out of our business wallet at Maplerad. If it can't
  // cover this amount, Maplerad refuses at execution — after the user has
  // pressed Confirm. Say so now instead. An unreadable balance doesn't block.
  const held = await getProviderBalanceMinor(fxCurrencyOf(params.fromAsset));
  if (held !== null && held < providerAmount) {
    console.error("[fx] business wallet too low for a swap — top it up", {
      currency: fxCurrencyOf(params.fromAsset),
      heldMinor: held.toString(),
      neededMinor: providerAmount.toString(),
    });
    throw new ApiError(
      503,
      "Swaps are briefly limited right now. Please try a smaller amount or try again shortly.",
      "liquidity_low",
    );
  }

  const fx = await quoteFx({
    sourceCurrency: fxCurrencyOf(params.fromAsset),
    targetCurrency: fxCurrencyOf(params.toAsset),
    amount: Number(providerAmount),
  }).catch((err) => {
    throw fxQuoteError(err, params.fromAsset, params.toAsset);
  });

  if (!Number.isInteger(fx.target?.amount) || fx.target.amount <= 0) {
    throw new ApiError(
      502,
      "The exchange provider did not return a usable amount for that conversion",
      "bad_fx_quote",
    );
  }
  // The business spread, withheld from what the provider returns. This rail
  // never sees SWAP_SPREAD_BPS — that one prices a rate we compute ourselves,
  // whereas here Maplerad sets the rate and our margin is the slice we keep of
  // the amount it produces. Taken in the asset the user receives, so the
  // difference stays in treasury.
  const grossOutMinor = BigInt(fx.target.amount) * providerScale(params.toAsset);
  const marginBps = await railMarginBps(params.fromAsset, params.toAsset);
  let feeOutMinor = feeFromBps(grossOutMinor, marginBps);
  let amountOutMinor = grossOutMinor - feeOutMinor;

  // A buy or sell of a stablecoin for naira keeps at least a flat naira profit
  // on top of the percentage spread. A NGN↔USD convert is left on the spread
  // alone — the floor is for trades, not for moving dollars in and out.
  const kind = classifySwap(params.fromAsset, params.toAsset);
  if (kind === "buy" || kind === "sell") {
    const minMarginNgn = await getMinTradeMarginNgn();
    if (minMarginNgn > 0) {
      // Mid naira per whole out unit: 1 for a sell (out = naira), else the
      // naira paid in per whole coin the provider returned before our spread.
      const ngnPerOutWhole =
        params.toAsset === Asset.NGN
          ? new Prisma.Decimal(1)
          : new Prisma.Decimal(amountInMinor.toString())
              .div(100)
              .div(
                new Prisma.Decimal(grossOutMinor.toString()).div(
                  new Prisma.Decimal(10).pow(ASSET_DECIMALS[params.toAsset]),
                ),
              );
      const flooredOut = floorOutToMinMarginNgn({
        grossOutMinor,
        netOutMinor: amountOutMinor,
        outAsset: params.toAsset,
        ngnPerOutWhole,
        minMarginNgn,
      });
      if (flooredOut !== amountOutMinor) {
        amountOutMinor = flooredOut;
        feeOutMinor = grossOutMinor - amountOutMinor;
      }
    }
  }

  if (amountOutMinor <= 0n) {
    throw new ApiError(
      422,
      "That amount is too small to convert after the exchange spread",
      "amount_too_small",
    );
  }
  const ngnLegMinor = params.fromAsset === Asset.NGN ? amountInMinor : amountOutMinor;
  if (!isWithinSingleTxLimit(params.tier, ngnLegMinor)) {
    throw new ApiError(403, "Amount exceeds your per-transaction limit", "single_tx_limit");
  }

  // The USD enum value and the provider_ref column must exist for the typed write.
  await Promise.all([ensureUsdAsset(), ensureQuoteProviderRef()]);

  const quote = await prisma.quote.create({
    data: {
      userId: params.userId,
      fromAsset: params.fromAsset,
      toAsset: params.toAsset,
      // Derived from the legs, not read from fx.rate — see rateFromLegs.
      rate:
        params.ngnPerCryptoRate && params.fromAsset === Asset.NGN
          ? rateFromLegs(params.toAsset, amountOutMinor, params.fromAsset, amountInMinor)
          : rateFromLegs(params.fromAsset, amountInMinor, params.toAsset, amountOutMinor),
      amountIn: amountInMinor,
      amountOut: amountOutMinor,
      providerRef: fx.reference,
      expiresAt: new Date(Date.now() + QUOTE_TTL_MS),
    },
  });
  // The fee is for display only: execution settles the stored amountOut.
  return { ...quote, feeOutMinor, feeBps: marginBps };
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

  // A rail swap (NGN↔USD, or NGN↔stablecoin backed at Maplerad) settles through
  // the real FX rail, which involves an external call that cannot live inside a
  // DB transaction.
  if (quote.providerRef && settlesOnFxRail(quote.fromAsset, quote.toAsset)) {
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

  // The same spread the quote was priced with, so recorded revenue matches it.
  const spreadBps = await getSwapSpreadBpsFor(kind);
  const spreadMinor =
    spreadBps > 0 && spreadBps < 10_000
      ? (quote.amountOut * BigInt(Math.trunc(spreadBps))) / BigInt(10_000 - Math.trunc(spreadBps))
      : 0n;

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
          // Revenue: our spread, backed out of the quoted net, in minor units
          // of toAsset — the same fields the FX path records. Read by revenue
          // reports and influencer commission; balances don't use it.
          spreadMinor: spreadMinor.toString(),
          spreadAsset: quote.toAsset,
          spreadBps,
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
 * Settle a rail swap on Maplerad's real FX rail: a NGN↔USD convert, or a
 * USDT/USDC buy or sell for naira, which Maplerad settles as NGN↔USD (it keeps
 * stablecoins as dollars).
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
  let settled: Awaited<ReturnType<typeof exchangeFx>>;
  try {
    settled = await exchangeFx({ quoteReference: quote.providerRef as string });
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

  // What the exchange actually produced. A quote is a promise about a rate, not
  // a guarantee about an amount: if the provider settled at a different figure,
  // that figure is the money that exists, and crediting the quoted one would
  // put the ledger out of step with the treasury in one direction or the other.
  // The quote is the fallback for a response that does not report an amount.
  const settledGross =
    Number.isInteger(settled?.target?.amount) && settled.target.amount > 0
      ? BigInt(settled.target.amount) * providerScale(quote.toAsset)
      : null;

  // The margin has to come off here too, not just at quote time. This path
  // deliberately credits what the provider actually settled over what was
  // quoted, so crediting the settled amount raw would hand the spread straight
  // back — the quote would promise a margin the execution then gives away.
  // When the provider settles exactly what it quoted, this lands on
  // quote.amountOut, so the normal case is unchanged.
  const marginBps = await railMarginBps(quote.fromAsset, quote.toAsset);
  const settleKind = classifySwap(quote.fromAsset, quote.toAsset);
  let creditMinor =
    settledGross === null ? quote.amountOut : settledGross - feeFromBps(settledGross, marginBps);
  // If the provider settled a different amount than it quoted, re-apply the
  // flat naira floor to that amount too — otherwise a drifting settlement
  // could hand back the minimum margin the quote promised.
  if (settledGross !== null && (settleKind === "buy" || settleKind === "sell")) {
    const minMarginNgn = await getMinTradeMarginNgn();
    if (minMarginNgn > 0) {
      const ngnPerOutWhole =
        quote.toAsset === Asset.NGN
          ? new Prisma.Decimal(1)
          : new Prisma.Decimal(quote.amountIn.toString())
              .div(100)
              .div(
                new Prisma.Decimal(settledGross.toString()).div(
                  new Prisma.Decimal(10).pow(ASSET_DECIMALS[quote.toAsset]),
                ),
              );
      creditMinor = floorOutToMinMarginNgn({
        grossOutMinor: settledGross,
        netOutMinor: creditMinor,
        outAsset: quote.toAsset,
        ngnPerOutWhole,
        minMarginNgn,
      });
    }
  }
  // Our spread on this exchange, in the to-asset, kept on the row for revenue
  // reporting. Without a settled figure it is backed out of the quoted net.
  const spreadMinor =
    settledGross !== null
      ? settledGross - creditMinor
      : marginBps > 0 && marginBps < 10_000
      ? (quote.amountOut * BigInt(Math.trunc(marginBps))) / BigInt(10_000 - Math.trunc(marginBps))
      : 0n;

  if (creditMinor !== quote.amountOut) {
    console.warn("[fx] settled amount differs from the quote — crediting what settled", {
      userId: params.userId,
      quoteId: quote.id,
      quotedNet: quote.amountOut.toString(),
      settledGross: settledGross?.toString() ?? null,
      creditingNet: creditMinor.toString(),
      providerRef: quote.providerRef,
    });
  }

  // 3. Credit + record. A stablecoin buy or sell is still recorded, named and
  // rewarded as the buy or sell it is; only how it settled differs.
  const kind = classifySwap(quote.fromAsset, quote.toAsset);
  let result: { transactionId: string; status: TransactionStatus };
  try {
    result = await prisma.$transaction(async (db) => {
      await db.balance.upsert({
        where: { userId_asset: { userId: params.userId, asset: quote.toAsset } },
        update: { available: { increment: creditMinor } },
        create: { userId: params.userId, asset: quote.toAsset, available: creditMinor },
      });
      const record = await db.transaction.create({
        data: {
          userId: params.userId,
          type:
            kind === "buy"
              ? TransactionType.BUY
              : kind === "sell"
              ? TransactionType.SELL
              : TransactionType.CONVERT,
          asset: kind === "buy" ? quote.toAsset : quote.fromAsset,
          amount: kind === "buy" ? creditMinor : quote.amountIn,
          status: TransactionStatus.COMPLETED,
          idempotencyKey: params.idempotencyKey,
          quoteId: quote.id,
          metadata: {
            kind,
            ...(kind === "convert" ? {} : { side: kind }),
            rail: "maplerad_fx",
            providerRef: quote.providerRef,
            fromAsset: quote.fromAsset,
            toAsset: quote.toAsset,
            amountIn: quote.amountIn.toString(),
            amountOut: creditMinor.toString(),
            quotedAmountOut: quote.amountOut.toString(),
            rate: quote.rate.toString(),
            // Revenue: our spread, in minor units of toAsset.
            spreadMinor: spreadMinor.toString(),
            spreadAsset: quote.toAsset,
            spreadBps: marginBps,
          },
        },
      });
      await db.auditLog.create({
        data: {
          userId: params.userId,
          action: kind === "convert" ? "swap.fx" : `swap.${kind}`,
          resourceType: "Transaction",
          resourceId: record.id,
          details: {
            fromAsset: quote.fromAsset,
            toAsset: quote.toAsset,
            amountIn: quote.amountIn.toString(),
            amountOut: creditMinor.toString(),
            quotedAmountOut: quote.amountOut.toString(),
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
        amountOut: creditMinor.toString(),
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

  // Cashback on the NGN leg of a buy or sell, as on any other buy or sell.
  if (kind !== "convert") {
    await awardCashback({
      userId: params.userId,
      source: "trade",
      baseNgnMinor: quote.fromAsset === Asset.NGN ? quote.amountIn : creditMinor,
      sourceTransactionId: result.transactionId,
    });
  }

  // Confirmation (best-effort, after commit).
  const fmt = (m: bigint, a: Asset) =>
    a === Asset.USD
      ? `$${fromMinorUnits(m, a)}`
      : a === Asset.NGN
      ? `₦${fromMinorUnits(m, a)}`
      : `${fromMinorUnits(m, a)} ${a}`;
  await notifyUser(params.userId, {
    category: "trades",
    title: kind === "buy" ? "Purchase complete" : kind === "sell" ? "Sale complete" : "Conversion complete",
    body:
      kind === "buy"
        ? `Bought ${fmt(creditMinor, quote.toAsset)} for ${fmt(quote.amountIn, quote.fromAsset)}.`
        : kind === "sell"
        ? `Sold ${fmt(quote.amountIn, quote.fromAsset)} for ${fmt(creditMinor, quote.toAsset)}.`
        : `Converted ${fmt(quote.amountIn, quote.fromAsset)} to ${fmt(creditMinor, quote.toAsset)}.`,
    data: { transactionId: result.transactionId },
  });

  return result;
}
