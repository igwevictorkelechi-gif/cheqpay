import {
  Asset,
  Prisma,
  TransactionStatus,
  TransactionType,
  prisma,
} from "@cheqpay/db";
import { ApiError } from "./http";
import { isWithinSingleTxLimit } from "./kyc";
import {
  computeCryptoConvert,
  computeSwap,
  cryptoToNgnKobo,
  type SwapSide,
} from "./rates";
import { getSwapSpreadBps, getUsdtNgnRate } from "./settings";
import { getPriceFeed } from "@/market";

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
 * Create a crypto-to-crypto convert quote (e.g. BTC -> USDT). Priced from each
 * asset's USDT spot with the business spread applied once. The NGN value of the
 * input is used only to enforce the tier single-tx limit.
 */
export async function createConvertQuote(params: {
  userId: string;
  tier: number;
  fromAsset: Asset; // BTC | USDT
  toAsset: Asset; // BTC | USDT
  amountInMinor: bigint;
}) {
  if (params.fromAsset === params.toAsset) {
    throw new ApiError(422, "Cannot convert an asset to itself", "same_asset");
  }
  const usdtNgnRate = await getUsdtNgnRate();
  if (usdtNgnRate === null) {
    throw new ApiError(503, "USDT→NGN rate not configured by admin", "no_rate");
  }
  const spreadBps = await getSwapSpreadBps();
  const feed = getPriceFeed();
  const [fromUsdtPrice, toUsdtPrice] = await Promise.all([
    feed.getSpotUsdt(params.fromAsset),
    feed.getSpotUsdt(params.toAsset),
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
    new Prisma.Decimal(usdtNgnRate)
  );
  if (!isWithinSingleTxLimit(params.tier, ngnValueKobo)) {
    throw new ApiError(403, "Amount exceeds your per-transaction limit", "single_tx_limit");
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

  // A convert has crypto on both legs; otherwise one leg is NGN (buy/sell).
  const isConvert = quote.fromAsset !== Asset.NGN && quote.toAsset !== Asset.NGN;
  const side: SwapSide = quote.fromAsset === Asset.NGN ? "buy" : "sell";
  const cryptoAsset = side === "buy" ? quote.toAsset : quote.fromAsset;
  const cryptoAmountMinor = side === "buy" ? quote.amountOut : quote.amountIn;

  return prisma.$transaction(async (db) => {
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
          : side === "buy"
          ? TransactionType.BUY
          : TransactionType.SELL,
        asset: cryptoAsset,
        amount: cryptoAmountMinor,
        status: TransactionStatus.COMPLETED,
        idempotencyKey: params.idempotencyKey,
        quoteId: quote.id,
        metadata: {
          kind: isConvert ? "convert" : side,
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
        action: `swap.${side}`,
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
}
