import type { Asset } from "@cheqpay/db";
import { ApiError } from "./http";

/**
 * Minor-unit decimals per asset:
 *  - NGN  -> 2 (kobo)
 *  - BTC  -> 8 (satoshi)
 *  - USDT -> 6 (base units)
 */
export const ASSET_DECIMALS: Record<Asset, number> = {
  NGN: 2,
  BTC: 8,
  USDT: 6,
};

export function decimalsFor(asset: Asset): number {
  return ASSET_DECIMALS[asset];
}

/**
 * Convert a human decimal string (e.g. "0.00123456") to integer minor units
 * for the given asset. Pure string math — no floating point, no precision loss.
 * Throws on malformed input or excess precision.
 */
export function toMinorUnits(amount: string, asset: Asset): bigint {
  const decimals = decimalsFor(asset);
  const trimmed = amount.trim();

  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
    throw new ApiError(422, `Invalid amount: "${amount}"`, "bad_amount");
  }

  const negative = trimmed.startsWith("-");
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [whole, fraction = ""] = unsigned.split(".");

  if (fraction.length > decimals) {
    throw new ApiError(
      422,
      `Amount "${amount}" exceeds ${decimals} decimals for ${asset}`,
      "excess_precision"
    );
  }

  const padded = fraction.padEnd(decimals, "0");
  const combined = `${whole}${padded}`.replace(/^0+(?=\d)/, "");
  const value = BigInt(combined === "" ? "0" : combined);
  return negative ? -value : value;
}

/**
 * Format integer minor units back to a human decimal string for the asset.
 * Inverse of toMinorUnits.
 */
export function fromMinorUnits(minor: bigint, asset: Asset): string {
  const decimals = decimalsFor(asset);
  const negative = minor < 0n;
  const digits = (negative ? -minor : minor).toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = decimals > 0 ? digits.slice(digits.length - decimals) : "";
  const body = decimals > 0 ? `${whole}.${fraction}` : whole;
  return negative ? `-${body}` : body;
}
