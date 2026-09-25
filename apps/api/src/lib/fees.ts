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

import { ApiError } from "./http";

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
