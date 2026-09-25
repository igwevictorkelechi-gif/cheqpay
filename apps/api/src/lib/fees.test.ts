import { describe, expect, it } from "vitest";
import { withdrawalBreakdown } from "./fees";

const NGN = (naira: number) => BigInt(naira) * 100n;

describe("withdrawalBreakdown", () => {
  it("takes the fee out of the amount withdrawn", () => {
    // ₦100,000 withdrawn, ₦200 fee → ₦99,800 reaches the bank.
    expect(withdrawalBreakdown(NGN(100_000), NGN(200))).toEqual({
      grossMinor: NGN(100_000),
      feeMinor: NGN(200),
      payoutMinor: NGN(99_800),
    });
  });

  it("is the whole amount when there is no fee", () => {
    expect(withdrawalBreakdown(NGN(5_000), 0n).payoutMinor).toBe(NGN(5_000));
  });

  it("lets Max withdraw the entire balance, kobo included", () => {
    const balance = 12_345_678n; // ₦123,456.78
    const b = withdrawalBreakdown(balance, NGN(200));
    expect(b.grossMinor).toBe(balance);
    expect(b.payoutMinor + b.feeMinor).toBe(balance);
  });

  it("refuses an amount the fee would swallow", () => {
    expect(() => withdrawalBreakdown(NGN(200), NGN(200))).toThrow(/doesn't cover/);
    expect(() => withdrawalBreakdown(NGN(150), NGN(200))).toThrow(/doesn't cover/);
  });

  it("refuses a zero or negative amount", () => {
    expect(() => withdrawalBreakdown(0n, 0n)).toThrow();
    expect(() => withdrawalBreakdown(-1n, 0n)).toThrow();
  });
});
