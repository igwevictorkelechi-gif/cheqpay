import { Asset, Prisma } from "@cheqpay/db";
import { ASSET_DECIMALS } from "./money";
import { ApiError } from "./http";

const D = Prisma.Decimal;
type Decimal = Prisma.Decimal;

export type SwapSide = "buy" | "sell";

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
 * Compute a crypto-to-crypto convert (e.g. BTC -> USDT), money-safe:
 *  - value the input in USDT using the from-asset's USDT spot
 *  - apply the full business spread once (user receives slightly less)
 *  - convert that USDT value into the to-asset at its USDT spot
 *  - FLOOR to integer minor units (never over-credit)
 *
 * `rate` is stored as TO-asset whole units per 1 FROM-asset whole unit.
 */
export function computeCryptoConvert(params: {
  fromAsset: Asset; // BTC | USDT
  toAsset: Asset; // BTC | USDT
  amountInMinor: bigint;
  fromUsdtPrice: Decimal; // USDT per 1 from-asset (USDT itself = 1)
  toUsdtPrice: Decimal; // USDT per 1 to-asset (USDT itself = 1)
  spreadBps: number;
}): SwapComputation {
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

  if (amountOutMinor <= 0n) {
    throw new ApiError(422, "Amount too small to convert", "dust_amount");
  }
  // Effective TO per 1 FROM (after spread).
  const rate = params.fromUsdtPrice.div(params.toUsdtPrice).mul(new D(1).sub(s));
  return { amountOutMinor, rate };
}

function floorToBigInt(d: Decimal): bigint {
  return BigInt(d.floor().toFixed(0));
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
