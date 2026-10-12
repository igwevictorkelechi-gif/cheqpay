import { describe, expect, it } from "vitest";
import { cardFundFeeFor, parseExpiry } from "./cards";

describe("card helpers", () => {
  it("charges the plan's top-up fee in basis points", () => {
    expect(cardFundFeeFor({ cardFundFeeBps: 150 }, 10_000n)).toBe(150n);
    expect(cardFundFeeFor({ cardFundFeeBps: 125 }, 999n)).toBe(12n);
    expect(cardFundFeeFor({ cardFundFeeBps: 0 }, 10_000n)).toBe(0n);
  });

  it("reads the issuer's expiry in either year form, and nothing else", () => {
    expect(parseExpiry("09/29")).toEqual([9, 2029]);
    expect(parseExpiry("1/2031")).toEqual([1, 2031]);
    expect(parseExpiry(" 12 / 30 ")).toEqual([12, 2030]);
    expect(parseExpiry("13/29")).toBeNull();
    expect(parseExpiry("0929")).toBeNull();
    expect(parseExpiry(undefined)).toBeNull();
  });
});
