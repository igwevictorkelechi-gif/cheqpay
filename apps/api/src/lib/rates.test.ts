import { describe, expect, it } from "vitest";
import { Asset, Prisma } from "@cheqpay/db";
import { computeSwap, cryptoToNgnKobo, effectivePrice } from "./rates";

const D = (v: string | number) => new Prisma.Decimal(v);

describe("effectivePrice", () => {
  it("adds spread on buy, subtracts on sell", () => {
    const mid = D("100000000"); // NGN per BTC
    expect(effectivePrice(mid, "buy", 1000).toString()).toBe("110000000"); // +10%
    expect(effectivePrice(mid, "sell", 1000).toString()).toBe("90000000"); // -10%
    expect(effectivePrice(mid, "buy", 0).toString()).toBe("100000000");
  });
});

describe("computeSwap", () => {
  // mid = 50000 USDT/BTC * 2000 NGN/USDT = 100,000,000 NGN/BTC
  const price = D("50000");
  const rate = D("2000");

  it("buy BTC with NGN, no spread", () => {
    // spend 100,000 NGN = 10,000,000 kobo -> 0.001 BTC = 100,000 sat
    const r = computeSwap({
      side: "buy",
      cryptoAsset: Asset.BTC,
      amountInMinor: 10_000_000n,
      cryptoUsdtPrice: price,
      usdtNgnRate: rate,
      spreadBps: 0,
    });
    expect(r.amountOutMinor).toBe(100_000n);
  });

  it("buy BTC applies spread (user gets less crypto)", () => {
    // eff = 110,000,000; 100,000 / 110,000,000 = 0.000909.. BTC -> 90909 sat (floor)
    const r = computeSwap({
      side: "buy",
      cryptoAsset: Asset.BTC,
      amountInMinor: 10_000_000n,
      cryptoUsdtPrice: price,
      usdtNgnRate: rate,
      spreadBps: 1000,
    });
    expect(r.amountOutMinor).toBe(90_909n);
  });

  it("sell BTC for NGN, no spread", () => {
    // 0.001 BTC (100,000 sat) -> 100,000 NGN = 10,000,000 kobo
    const r = computeSwap({
      side: "sell",
      cryptoAsset: Asset.BTC,
      amountInMinor: 100_000n,
      cryptoUsdtPrice: price,
      usdtNgnRate: rate,
      spreadBps: 0,
    });
    expect(r.amountOutMinor).toBe(10_000_000n);
  });

  it("sell BTC applies spread (user gets less NGN)", () => {
    // eff = 90,000,000; 0.001 * 90,000,000 = 90,000 NGN = 9,000,000 kobo
    const r = computeSwap({
      side: "sell",
      cryptoAsset: Asset.BTC,
      amountInMinor: 100_000n,
      cryptoUsdtPrice: price,
      usdtNgnRate: rate,
      spreadBps: 1000,
    });
    expect(r.amountOutMinor).toBe(9_000_000n);
  });

  it("buy USDT with NGN uses price 1", () => {
    // rate 2000, spread 0: 2000 NGN = 200,000 kobo -> 1 USDT = 1,000,000 (6dp)
    const r = computeSwap({
      side: "buy",
      cryptoAsset: Asset.USDT,
      amountInMinor: 200_000n,
      cryptoUsdtPrice: D("1"),
      usdtNgnRate: rate,
      spreadBps: 0,
    });
    expect(r.amountOutMinor).toBe(1_000_000n);
  });

  it("values crypto in NGN kobo (no spread)", () => {
    // 0.001 BTC (100,000 sat) at 50,000 USDT * 2,000 NGN = 100,000 NGN/BTC
    // -> 0.001 * 100,000,000 = 100,000 NGN = 10,000,000 kobo
    expect(cryptoToNgnKobo(100_000n, Asset.BTC, price, rate)).toBe(10_000_000n);
    // 5 USDT at rate 2000 -> 10,000 NGN = 1,000,000 kobo
    expect(cryptoToNgnKobo(5_000_000n, Asset.USDT, D("1"), rate)).toBe(1_000_000n);
  });

  it("rejects dust and non-positive amounts", () => {
    expect(() =>
      computeSwap({
        side: "buy",
        cryptoAsset: Asset.BTC,
        amountInMinor: 0n,
        cryptoUsdtPrice: price,
        usdtNgnRate: rate,
        spreadBps: 0,
      })
    ).toThrow();
  });
});
