import { describe, expect, it } from "vitest";
import { fromMinorUnits, toMinorUnits } from "./money";

describe("toMinorUnits", () => {
  it("converts BTC (8 dp) to satoshis", () => {
    expect(toMinorUnits("1", "BTC")).toBe(100_000_000n);
    expect(toMinorUnits("0.00000001", "BTC")).toBe(1n);
    expect(toMinorUnits("1.23456789", "BTC")).toBe(123_456_789n);
  });

  it("converts USDT (6 dp) to base units", () => {
    expect(toMinorUnits("1", "USDT")).toBe(1_000_000n);
    expect(toMinorUnits("0.000001", "USDT")).toBe(1n);
    expect(toMinorUnits("250.5", "USDT")).toBe(250_500_000n);
  });

  it("converts NGN (2 dp) to kobo", () => {
    expect(toMinorUnits("1000", "NGN")).toBe(100_000n);
    expect(toMinorUnits("1000.50", "NGN")).toBe(100_050n);
  });

  it("handles large values without precision loss", () => {
    expect(toMinorUnits("21000000", "BTC")).toBe(2_100_000_000_000_000n);
  });

  it("rejects excess precision", () => {
    expect(() => toMinorUnits("0.000000001", "BTC")).toThrow(); // 9 dp > 8
    expect(() => toMinorUnits("1.0000001", "USDT")).toThrow(); // 7 dp > 6
  });

  it("rejects malformed amounts", () => {
    expect(() => toMinorUnits("", "BTC")).toThrow();
    expect(() => toMinorUnits("abc", "BTC")).toThrow();
    expect(() => toMinorUnits("1.2.3", "BTC")).toThrow();
  });

  it("round-trips through fromMinorUnits", () => {
    for (const [amt, asset] of [
      ["1.23456789", "BTC"],
      ["250.500000", "USDT"],
      ["1000.50", "NGN"],
    ] as const) {
      const minor = toMinorUnits(amt, asset);
      expect(fromMinorUnits(minor, asset)).toBe(amt);
    }
  });
});

describe("fromMinorUnits", () => {
  it("formats minor units back to decimals", () => {
    expect(fromMinorUnits(1n, "BTC")).toBe("0.00000001");
    expect(fromMinorUnits(100_000_000n, "BTC")).toBe("1.00000000");
    expect(fromMinorUnits(100_050n, "NGN")).toBe("1000.50");
  });
});
