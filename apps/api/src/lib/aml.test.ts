import { describe, expect, it } from "vitest";
import { assessWithdrawal, type AmlConfig } from "./aml";

const cfg: AmlConfig = {
  largeAmountKobo: 100_000_000n, // 1,000,000 NGN
  reviewThresholdKobo: 500_000_000n, // 5,000,000 NGN
  velocityCount: 10,
  velocitySumKobo: 1_000_000_000n, // 10,000,000 NGN
  sanctioned: new Set(["bc1sanctioned"]),
};

describe("assessWithdrawal", () => {
  it("passes a normal small withdrawal", () => {
    const a = assessWithdrawal(
      { ngnValueKobo: 5_000_000n, toAddress: "bc1clean", recentCount: 1, recentSumKobo: 5_000_000n },
      cfg
    );
    expect(a.blocked).toBe(false);
    expect(a.holdForReview).toBe(false);
    expect(a.reasons).toEqual([]);
  });

  it("blocks a sanctioned destination", () => {
    const a = assessWithdrawal(
      { ngnValueKobo: 1000n, toAddress: "BC1Sanctioned", recentCount: 0, recentSumKobo: 0n },
      cfg
    );
    expect(a.blocked).toBe(true);
    expect(a.reasons).toContain("sanctioned_address");
  });

  it("holds large amounts for review", () => {
    const a = assessWithdrawal(
      { ngnValueKobo: 150_000_000n, toAddress: "bc1clean", recentCount: 0, recentSumKobo: 0n },
      cfg
    );
    expect(a.holdForReview).toBe(true);
    expect(a.reasons).toContain("large_amount");
  });

  it("holds on velocity count", () => {
    const a = assessWithdrawal(
      { ngnValueKobo: 1000n, toAddress: "bc1clean", recentCount: 10, recentSumKobo: 0n },
      cfg
    );
    expect(a.holdForReview).toBe(true);
    expect(a.reasons).toContain("velocity_count");
  });

  it("holds when cumulative window sum is exceeded", () => {
    const a = assessWithdrawal(
      { ngnValueKobo: 100_000_000n, toAddress: "bc1clean", recentCount: 1, recentSumKobo: 950_000_000n },
      cfg
    );
    expect(a.holdForReview).toBe(true);
    expect(a.reasons).toContain("velocity_sum");
  });
});
