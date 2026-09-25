// apps/api/src/lib/fees.ts
//
// How a fee splits an amount, in one place.
//
// The NGN withdrawal fee comes OUT of the amount the user asks to withdraw: they
// type ₦100,000, the fee is ₦200, the bank receives ₦99,800, and their balance
// drops by exactly ₦100,000. That is what makes a "Max" button work — Max is the
// whole balance, and nothing is left over for a fee to overdraw. It also matches
// conversions, where the spread comes out of what you receive, never on top.
//
// The apps show the same breakdown before the user confirms; the server is the
// one that actually applies it, so the number the user saw is the number paid.

import { Asset, Prisma } from "@cheqpay/db";
import { ApiError } from "./http";
import { ASSET_DECIMALS } from "./money";
import type { Pricing } from "./settings";

export interface WithdrawalBreakdown {
  /** What leaves the user's balance — the amount they asked to withdraw. */
  grossMinor: bigint;
  /** Our fee, taken out of the gross. */
  feeMinor: bigint;
  /** What the bank account receives. */
  payoutMinor: bigint;
}

/** Split a withdrawal into fee and payout. Refuses one the fee would swallow. */
export function withdrawalBreakdown(grossMinor: bigint, feeMinor: bigint): WithdrawalBreakdown {
  if (grossMinor <= 0n) throw new ApiError(422, "Amount must be positive", "bad_amount");
  if (feeMinor < 0n) throw new ApiError(500, "Withdrawal fee is misconfigured", "bad_fee");
  const payoutMinor = grossMinor - feeMinor;
  if (payoutMinor <= 0n) {
    throw new ApiError(
      422,
      `That amount doesn't cover the ₦${(Number(feeMinor) / 100).toLocaleString("en-NG")} withdrawal fee`,
      "below_fee",
    );
  }
  return { grossMinor, feeMinor, payoutMinor };
}

// --- The price sheet as arithmetic -------------------------------------------
//
// Every fee below is Maplerad's cost to us plus our margin (see PRICING_DEFAULTS
// in settings.ts). Pure functions, so the server charges and the screens show
// exactly the same number.

const bpsOf = (amountMinor: bigint, bps: number): bigint =>
  bps <= 0 ? 0n : (amountMinor * BigInt(Math.trunc(bps))) / 10_000n;

const usdToCents = (usd: number): bigint => BigInt(Math.round(usd * 100));

/** Fee on an NGN deposit (kobo): a percentage, capped. A cap of 0 means none. */
export function ngnDepositFee(amountKobo: bigint, bps: number, capNgn: number): bigint {
  const fee = bpsOf(amountKobo, bps);
  const cap = capNgn > 0 ? BigInt(Math.round(capNgn * 100)) : null;
  return cap !== null && fee > cap ? cap : fee;
}

/** Fee on a USD bank deposit (cents): one rate below the threshold, a lower one from it. */
export function usdDepositFee(amountCents: bigint, p: Pricing): bigint {
  const large = amountCents >= usdToCents(p.usdDepositLargeThresholdUsd);
  return bpsOf(amountCents, large ? p.usdDepositLargeFeeBps : p.usdDepositFeeBps);
}

/** Fee on a stablecoin deposit that lands as USD (cents). */
export function cryptoDepositFee(amountCents: bigint, p: Pricing): bigint {
  return bpsOf(amountCents, p.cryptoDepositFeeBps);
}

/**
 * Fee to top up a card (cents), added on top of the top-up. A flat fee for
 * small top-ups, a percentage from the threshold. Refuses below the minimum.
 */
export function cardFundFee(amountCents: bigint, p: Pricing): bigint {
  if (amountCents < usdToCents(p.cardFundMinUsd)) {
    throw new ApiError(
      422,
      `The smallest card top-up is $${p.cardFundMinUsd.toFixed(2)}`,
      "below_minimum"
    );
  }
  return amountCents >= usdToCents(p.cardFundThresholdUsd)
    ? bpsOf(amountCents, p.cardFundFeeLargeBps)
    : usdToCents(p.cardFundFeeSmallUsd);
}

/** Fee to take money off a card back to the wallet (cents). */
export function cardWithdrawFee(p: Pricing): bigint {
  return usdToCents(p.cardWithdrawFeeUsd);
}

/** Price of a new card (cents). */
export function cardIssueFee(p: Pricing): bigint {
  return usdToCents(p.cardIssueFeeUsd);
}

/**
 * A USD-denominated fee expressed in a coin's minor units at the coin's USD
 * price, rounded UP so the fee never undershoots its dollar value.
 */
export function usdFeeInCoin(feeUsd: number, asset: Asset, usdPrice: Prisma.Decimal): bigint {
  if (feeUsd <= 0) return 0n;
  if (usdPrice.lte(0)) throw new ApiError(503, `No price for ${asset}`, "no_price");
  const minor = new Prisma.Decimal(feeUsd)
    .div(usdPrice)
    .mul(new Prisma.Decimal(10).pow(ASSET_DECIMALS[asset]))
    .ceil();
  return BigInt(minor.toFixed(0));
}

/**
 * Split an amount the user typed into what's sent and our fee, the same way
 * NGN withdrawals do: the fee comes out of the amount, so Max always works.
 */
export function feeInclusiveSplit(
  grossMinor: bigint,
  feeMinor: bigint,
  label: string
): { grossMinor: bigint; feeMinor: bigint; netMinor: bigint } {
  if (grossMinor <= 0n) throw new ApiError(422, "Amount must be positive", "bad_amount");
  const netMinor = grossMinor - feeMinor;
  if (netMinor <= 0n) {
    throw new ApiError(422, `That amount doesn't cover the ${label} fee`, "below_fee");
  }
  return { grossMinor, feeMinor, netMinor };
}
