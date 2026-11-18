import { Asset, Prisma } from "@cheqpay/db";
import { ASSET_DECIMALS } from "./money";
import { ApiError } from "./http";

const D = Prisma.Decimal;
type Decimal = Prisma.Decimal;

export type SwapSide = "buy" | "sell";

/** The crypto assets the swap engine trades. Everything else is fiat. */
export const CRYPTO_ASSETS: Asset[] = [Asset.BTC, Asset.USDT, Asset.USDC];

export function isCryptoAsset(asset: Asset): boolean {
  return CRYPTO_ASSETS.includes(asset);
}

/**
 * USDT price (USDT per 1 whole unit) for the two fiats the convert engine
 * supports, or `null` for a crypto asset (whose price must come from the feed).
 * USD is treated as 1:1 with USDT (a dollar stablecoin); NGN is the inverse of
 * the business USDT→NGN rate. This is what lets `computeCryptoConvert` price any
 * pair in {NGN, USD, BTC, USDT, USDC} with the same generic maths.
 */
export function fiatUsdtPrice(asset: Asset, usdtNgnRate: Decimal): Decimal | null {
  if (asset === Asset.USD) return new D(1);
  if (asset === Asset.NGN) return new D(1).div(usdtNgnRate);
  return null;
}

/**
 * Classify a from→to pair. A buy spends NGN for crypto; a sell returns crypto to
 * NGN; everything else — crypto↔crypto, and anything touching USD (incl.
 * NGN↔USD) — is a convert. Kept here so the quote engine and clients agree on
 * which API a pair uses, and so cashback (buy/sell only) is applied consistently.
 */
export function classifySwap(fromAsset: Asset, toAsset: Asset): "buy" | "sell" | "convert" {
  if (fromAsset === Asset.NGN && isCryptoAsset(toAsset)) return "buy";
  if (toAsset === Asset.NGN && isCryptoAsset(fromAsset)) return "sell";
  return "convert";
}

/**
 * True for a NGN↔USD pair (in either direction). This is the one pair Maplerad's
 * FX rail settles, so it is priced and executed against real FX rather than the
 * synthetic USDT peg used for crypto legs.
 */
export function isNgnUsdPair(fromAsset: Asset, toAsset: Asset): boolean {
  return (
    (fromAsset === Asset.NGN && toAsset === Asset.USD) ||
    (fromAsset === Asset.USD && toAsset === Asset.NGN)
  );
}

/**
 * Effective NGN price per 1 whole crypto unit, with the business spread applied.
 * Buy = user pays a premium (mid × (1+s)); Sell = user receives less (mid × (1-s)).
 */
export function effectivePrice(
  midNgnPerUnit: Decimal,
  side: SwapSide,
  spreadBps: number
): Decimal {
  const s = new D(spreadBps).div(10_000);
  return side === "buy"
    ? midNgnPerUnit.mul(new D(1).add(s))
    : midNgnPerUnit.mul(new D(1).sub(s));
}

export interface SwapComputation {
  amountOutMinor: bigint;
  /** Effective NGN per 1 whole crypto unit, stored on the Quote. */
  rate: Decimal;
}

/**
 * Compute a swap, money-safe:
 *  - mid NGN/crypto = (crypto/USDT price) × (business USDT→NGN rate)
 *  - apply spread to get the effective price
 *  - convert via Decimal, then FLOOR to integer minor units (never over-credit)
 *
 * buy:  from NGN(kobo)  -> crypto(minor)
 * sell: from crypto(minor) -> NGN(kobo)
 */
export function computeSwap(params: {
  side: SwapSide;
  cryptoAsset: Asset; // BTC | USDT
  amountInMinor: bigint;
  cryptoUsdtPrice: Decimal; // USDT per 1 crypto (USDT itself = 1)
  usdtNgnRate: Decimal; // NGN per 1 USDT (business-set)
  spreadBps: number;
}): SwapComputation {
  if (params.amountInMinor <= 0n) {
    throw new ApiError(422, "Amount must be positive", "bad_amount");
  }
  const cryptoDecimals = ASSET_DECIMALS[params.cryptoAsset];
  const mid = params.cryptoUsdtPrice.mul(params.usdtNgnRate); // NGN per whole crypto
  const eff = effectivePrice(mid, params.side, params.spreadBps);
  if (eff.lte(0)) {
    throw new ApiError(500, "Invalid effective price", "bad_price");
  }

  let amountOutMinor: bigint;
  if (params.side === "buy") {
    const ngnWhole = new D(params.amountInMinor.toString()).div(100);
    const cryptoWhole = ngnWhole.div(eff);
    amountOutMinor = floorToBigInt(cryptoWhole.mul(new D(10).pow(cryptoDecimals)));
  } else {
    const cryptoWhole = new D(params.amountInMinor.toString()).div(
      new D(10).pow(cryptoDecimals)
    );
    const ngnWhole = cryptoWhole.mul(eff);
    amountOutMinor = floorToBigInt(ngnWhole.mul(100));
  }

  if (amountOutMinor <= 0n) {
    throw new ApiError(422, "Amount too small to swap", "dust_amount");
  }
  return { amountOutMinor, rate: eff };
}

/**
 * Compute a convert between any two supported assets (e.g. BTC -> USDT, or
 * USD -> NGN), money-safe:
 *  - value the input in USDT using the from-asset's USDT price
 *  - apply the full business spread once (user receives slightly less)
 *  - convert that USDT value into the to-asset at its USDT price
 *  - FLOOR to integer minor units (never over-credit)
 *
 * Fiat legs are priced via `fiatUsdtPrice` (USD 1:1, NGN = 1/rate); crypto legs
 * via the market feed. The maths is asset-agnostic — it only needs each leg's
 * USDT price and decimals.
 *
 * `rate` is stored as TO-asset whole units per 1 FROM-asset whole unit.
 */
export function computeCryptoConvert(params: {
  fromAsset: Asset; // any supported asset
  toAsset: Asset; // any supported asset
  amountInMinor: bigint;
  fromUsdtPrice: Decimal; // USDT per 1 from-asset (USDT itself = 1)
  toUsdtPrice: Decimal; // USDT per 1 to-asset (USDT itself = 1)
  spreadBps: number;
}): SwapComputation & {
  /** What the spread cost, in minor units of the TO asset: gross out − net out. */
  feeOutMinor: bigint;
} {
  if (params.amountInMinor <= 0n) {
    throw new ApiError(422, "Amount must be positive", "bad_amount");
  }
  if (params.fromAsset === params.toAsset) {
    throw new ApiError(422, "Cannot convert an asset to itself", "same_asset");
  }
  if (params.fromUsdtPrice.lte(0) || params.toUsdtPrice.lte(0)) {
    throw new ApiError(500, "Invalid price", "bad_price");
  }
  const fromDecimals = ASSET_DECIMALS[params.fromAsset];
  const toDecimals = ASSET_DECIMALS[params.toAsset];
  const s = new D(params.spreadBps).div(10_000);

  const fromWhole = new D(params.amountInMinor.toString()).div(
    new D(10).pow(fromDecimals)
  );
  const valueUsdt = fromWhole.mul(params.fromUsdtPrice).mul(new D(1).sub(s));
  const toWhole = valueUsdt.div(params.toUsdtPrice);
  const amountOutMinor = floorToBigInt(toWhole.mul(new D(10).pow(toDecimals)));
  // The same conversion with no spread, so the app can show what the spread
  // cost as an amount rather than leaving it hidden inside the rate.
  const grossOutMinor = floorToBigInt(
    fromWhole.mul(params.fromUsdtPrice).div(params.toUsdtPrice).mul(new D(10).pow(toDecimals)),
  );
  const feeOutMinor = grossOutMinor > amountOutMinor ? grossOutMinor - amountOutMinor : 0n;

  if (amountOutMinor <= 0n) {
    throw new ApiError(422, "Amount too small to convert", "dust_amount");
  }
  // Effective TO per 1 FROM (after spread).
  const rate = params.fromUsdtPrice.div(params.toUsdtPrice).mul(new D(1).sub(s));
  return { amountOutMinor, rate, feeOutMinor };
}

function floorToBigInt(d: Decimal): bigint {
  return BigInt(d.floor().toFixed(0));
}

function ceilToBigInt(d: Decimal): bigint {
  return BigInt(d.ceil().toFixed(0));
}

/**
 * Enforce a minimum business margin, in whole naira, on a buy or sell by
 * reducing what the user receives until the spread we keep is worth at least
 * `minMarginNgn`.
 *
 * Every swap already keeps a percentage spread, which earns too little on a
 * small trade — a ₦500 buy at a 2% spread is ₦10 to us. This floor tops that
 * up to a fixed naira amount so no trade is run for less than it costs to run.
 * It can only ever WIDEN our margin (reduce the payout), never narrow it, so a
 * trade whose spread already clears the floor is returned unchanged.
 *
 *  - `grossOutMinor`  — what the user would receive at the mid price (no spread)
 *  - `netOutMinor`    — what the quote currently pays (spread already applied)
 *  - `outAsset`       — the asset the user receives (the leg margin is kept in)
 *  - `ngnPerOutWhole` — mid naira value of one whole unit of the out asset
 *                       (1 when the out asset is NGN itself)
 *  - `minMarginNgn`   — the floor, in whole naira; 0 (or less) disables it
 *
 * The returned payout may be ≤ 0 for a trade too small to leave the floor
 * behind; the caller rejects that as a dust amount, exactly as it already does
 * for a payout the spread alone rounds away.
 */
export function floorOutToMinMarginNgn(params: {
  grossOutMinor: bigint;
  netOutMinor: bigint;
  outAsset: Asset;
  ngnPerOutWhole: Decimal;
  minMarginNgn: number;
}): bigint {
  if (params.minMarginNgn <= 0 || params.ngnPerOutWhole.lte(0)) return params.netOutMinor;
  const outDecimals = ASSET_DECIMALS[params.outAsset];
  // Out-asset minor units worth `minMarginNgn` at the mid price. Ceil so a
  // rounding never leaves the kept margin a hair under the floor.
  const minMarginOutMinor = ceilToBigInt(
    new D(params.minMarginNgn).div(params.ngnPerOutWhole).mul(new D(10).pow(outDecimals)),
  );
  const flooredNet = params.grossOutMinor - minMarginOutMinor;
  // Only ever reduce the payout; a trade whose spread already clears the floor
  // keeps its better rate.
  return flooredNet < params.netOutMinor ? flooredNet : params.netOutMinor;
}

/**
 * Value a crypto amount (minor units) in NGN kobo at the given price + business
 * rate. Used to enforce NGN-denominated limits on crypto withdrawals. No spread
 * (this is a valuation, not a trade).
 */
export function cryptoToNgnKobo(
  amountMinor: bigint,
  cryptoAsset: Asset,
  cryptoUsdtPrice: Decimal,
  usdtNgnRate: Decimal
): bigint {
  const cryptoWhole = new D(amountMinor.toString()).div(
    new D(10).pow(ASSET_DECIMALS[cryptoAsset])
  );
  return floorToBigInt(cryptoWhole.mul(cryptoUsdtPrice).mul(usdtNgnRate).mul(100));
}

/**
 * Value a crypto amount (minor units) in US cents at the given USDT price.
 *
 * Deliberately stops at USDT rather than going on to naira: a dollar-denominated
 * floor should not depend on the business USDT→NGN rate, which is admin-set and
 * can sit stale for weeks. USD is 1:1 with USDT here, the same peg
 * `fiatUsdtPrice` uses. No spread — this is a valuation, not a trade.
 */
export function cryptoToUsdCents(
  amountMinor: bigint,
  cryptoAsset: Asset,
  cryptoUsdtPrice: Decimal,
): bigint {
  const cryptoWhole = new D(amountMinor.toString()).div(
    new D(10).pow(ASSET_DECIMALS[cryptoAsset])
  );
  return floorToBigInt(cryptoWhole.mul(cryptoUsdtPrice).mul(100));
}

/**
 * Take a flat naira margin per $1 off a naira ⇄ dollar exchange the provider
 * has already priced. `grossOutMinor` is what the provider gives for
 * `amountInMinor`, so its rate IS our cost on this side of the book:
 *
 *  - naira in, dollars out (a customer BUYING USD/USDT/USDC): the provider's
 *    rate r = naira ÷ dollars. The customer pays r + margin per $1, so gets
 *    naira ÷ (r + margin) dollars. We exchange all of their naira and keep the
 *    dollars left over: exactly `margin` naira's worth per $1 they receive.
 *  - dollars in, naira out (a customer SELLING): they get r − margin per $1,
 *    i.e. the provider's naira less `margin` × dollars. We keep that naira.
 *
 * Rounds against the customer by at most one minor unit, never for them, so
 * the margin kept is never a hair under what the sheet says. A stablecoin
 * counts as $1, which is how Maplerad holds it.
 */
export function netOutAfterFlatMargin(params: {
  fromAsset: Asset;
  toAsset: Asset;
  amountInMinor: bigint;
  grossOutMinor: bigint;
  marginNgnPerUsd: number;
}): bigint {
  const { fromAsset, toAsset, amountInMinor, grossOutMinor, marginNgnPerUsd } = params;
  if (marginNgnPerUsd <= 0 || grossOutMinor <= 0n) return grossOutMinor;
  const m = new D(marginNgnPerUsd);
  if (fromAsset === Asset.NGN) {
    const ngnWhole = new D(amountInMinor.toString()).div(100);
    const outScale = new D(10).pow(ASSET_DECIMALS[toAsset]);
    const grossWhole = new D(grossOutMinor.toString()).div(outScale);
    // ngn / (ngn/gross + m)  ==  ngn·gross / (ngn + m·gross)
    const netWhole = ngnWhole.mul(grossWhole).div(ngnWhole.add(m.mul(grossWhole)));
    return floorToBigInt(netWhole.mul(outScale));
  }
  if (toAsset === Asset.NGN) {
    const dollarsWhole = new D(amountInMinor.toString()).div(new D(10).pow(ASSET_DECIMALS[fromAsset]));
    const marginKobo = ceilToBigInt(m.mul(dollarsWhole).mul(100));
    return grossOutMinor - marginKobo;
  }
  throw new ApiError(500, "A flat naira margin needs a naira leg", "bad_pair");
}

/**
 * The customer's NGN per $1 for a trade on our book: the provider's side of
 * the book plus the margin when they buy, minus it when they sell. Used where
 * we price the trade ourselves (BTC, or a stablecoin not backed at Maplerad).
 */
export function customerNgnPerUsd(side: SwapSide, book: { bid: number; ask: number }, marginNgnPerUsd: number): Decimal {
  const rate = side === "buy" ? new D(book.ask).add(marginNgnPerUsd) : new D(book.bid).sub(marginNgnPerUsd);
  if (rate.lte(0)) throw new ApiError(500, "The trade margin is larger than the dollar rate", "bad_price");
  return rate;
}
