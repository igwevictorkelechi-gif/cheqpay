import { describe, expect, it } from "vitest";
import { parseSpreadBps, parseUsdtNgnRate } from "./settings";

describe("platform setting parsers", () => {
  it("parses valid spread bps", () => {
    expect(parseSpreadBps("0")).toBe(0);
    expect(parseSpreadBps("150")).toBe(150);
    expect(parseSpreadBps("10000")).toBe(10_000);
  });

  it("rejects out-of-range or non-integer spread", () => {
    expect(() => parseSpreadBps("-1")).toThrow();
    expect(() => parseSpreadBps("10001")).toThrow();
    expect(() => parseSpreadBps("1.5")).toThrow();
    expect(() => parseSpreadBps("abc")).toThrow();
  });

  it("parses valid usdt->ngn rate", () => {
    expect(parseUsdtNgnRate("1750")).toBe(1750);
    expect(parseUsdtNgnRate("1234.56")).toBe(1234.56);
  });

  it("rejects non-positive or non-numeric rates", () => {
    expect(() => parseUsdtNgnRate("0")).toThrow();
    expect(() => parseUsdtNgnRate("-5")).toThrow();
    expect(() => parseUsdtNgnRate("nope")).toThrow();
  });
});
