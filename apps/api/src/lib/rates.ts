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

function floorToBigInt(d: Decimal): bigint {
  return BigInt(d.floor().toFixed(0));
}
