import { describe, expect, it } from "vitest";
import { parseAmountMinor } from "./compose";

describe("parseAmountMinor", () => {
  it("reads naira as people actually write it", () => {
    expect(parseAmountMinor("5000")).toBe(500_000n);
    expect(parseAmountMinor("5,000")).toBe(500_000n);
    expect(parseAmountMinor("₦5000")).toBe(500_000n);
    expect(parseAmountMinor(" 5000 ")).toBe(500_000n);
    expect(parseAmountMinor("5000.50")).toBe(500_050n);
    // Space as a thousands separator is unambiguous. It never actually reaches
    // here from the router (which captures the amount as a single \S+ token),
    // but reading it the obvious way beats refusing it.
    expect(parseAmountMinor("5 000")).toBe(500_000n);
  });

  it("handles the k/m shorthand Nigerians use", () => {
    expect(parseAmountMinor("5k")).toBe(500_000n);
    expect(parseAmountMinor("5K")).toBe(500_000n);
    expect(parseAmountMinor("2.5m")).toBe(250_000_000n);
  });

  it("agrees with itself however the same amount is written", () => {
    // "5k" and "₦5,000.00" must mean the same thing or neither should parse —
    // a disagreement here spends the wrong amount.
    const spellings = ["5000", "5,000", "₦5000", "₦5,000.00", "5k", "5.0k"];
    const parsed = spellings.map(parseAmountMinor);
    expect(new Set(parsed.map(String)).size).toBe(1);
    expect(parsed[0]).toBe(500_000n);
  });

  it("refuses rather than guesses", () => {
    for (const bad of ["", "abc", "-5000", "0", "5.123", "1e4", "5kk", "5m2", "₦", "5 or 6"]) {
      expect(parseAmountMinor(bad), bad).toBeNull();
    }
  });

  it("refuses an amount too large to be exact", () => {
    // Beyond Number.MAX_SAFE_INTEGER the k/m scaling would silently round.
    expect(parseAmountMinor("99999999999999999999m")).toBeNull();
  });
});
