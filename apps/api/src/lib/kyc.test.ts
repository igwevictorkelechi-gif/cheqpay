import { describe, expect, it } from "vitest";
import {
  getTierLimits,
  isWithinSingleTxLimit,
  remainingDailyDeposit,
  remainingDailyWithdrawal,
} from "./kyc";

describe("KYC tier limits", () => {
  it("tier 0 blocks all value movement", () => {
    expect(isWithinSingleTxLimit(0, 1n)).toBe(false);
    expect(getTierLimits(0).cryptoWithdrawalEnabled).toBe(false);
  });

  it("tier 1 allows small transactions but not crypto withdrawals", () => {
    const limits = getTierLimits(1);
    expect(limits.cryptoWithdrawalEnabled).toBe(false);
    // 50,000 NGN = 5,000,000 kobo
    expect(isWithinSingleTxLimit(1, 5_000_000n)).toBe(true);
    expect(isWithinSingleTxLimit(1, 5_000_001n)).toBe(false);
  });

  it("rejects zero / negative amounts", () => {
    expect(isWithinSingleTxLimit(1, 0n)).toBe(false);
    expect(isWithinSingleTxLimit(1, -1n)).toBe(false);
  });

  it("tier 2+ enables crypto withdrawals", () => {
    expect(getTierLimits(2).cryptoWithdrawalEnabled).toBe(true);
    expect(getTierLimits(3).cryptoWithdrawalEnabled).toBe(true);
  });

  it("unknown tiers fall back to tier 0", () => {
    expect(getTierLimits(99)).toEqual(getTierLimits(0));
  });

  it("computes remaining daily allowances and never goes negative", () => {
    // tier 1 daily deposit = 200,000 NGN = 20,000,000 kobo
    expect(remainingDailyDeposit(1, 0n)).toBe(20_000_000n);
    expect(remainingDailyDeposit(1, 15_000_000n)).toBe(5_000_000n);
    expect(remainingDailyDeposit(1, 25_000_000n)).toBe(0n);
    // tier 1 daily withdrawal = 100,000 NGN = 10,000,000 kobo
    expect(remainingDailyWithdrawal(1, 10_000_001n)).toBe(0n);
  });
});
