import { describe, expect, it } from "vitest";
import { Asset, Prisma } from "@cheqpay/db";
import {
  classifySwap,
  computeCryptoConvert,
  computeSwap,
  cryptoToNgnKobo,
  effectivePrice,
  fiatUsdtPrice,
  floorOutToMinMarginNgn,
  isNgnUsdPair,
} from "./rates";

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

describe("fiatUsdtPrice", () => {
  const rate = D("2000"); // NGN per USDT

  it("prices USD 1:1 with USDT", () => {
    expect(fiatUsdtPrice(Asset.USD, rate)!.toString()).toBe("1");
  });

  it("prices NGN as the inverse of the USDT→NGN rate", () => {
    expect(fiatUsdtPrice(Asset.NGN, rate)!.toString()).toBe("0.0005");
  });

  it("returns null for a crypto asset (feed must price it)", () => {
    expect(fiatUsdtPrice(Asset.BTC, rate)).toBeNull();
    expect(fiatUsdtPrice(Asset.USDT, rate)).toBeNull();
  });
});

describe("classifySwap", () => {
  it("NGN → crypto is a buy", () => {
    expect(classifySwap(Asset.NGN, Asset.BTC)).toBe("buy");
    expect(classifySwap(Asset.NGN, Asset.USDT)).toBe("buy");
  });

  it("crypto → NGN is a sell", () => {
    expect(classifySwap(Asset.USDT, Asset.NGN)).toBe("sell");
  });

  it("anything touching USD, or crypto↔crypto, is a convert", () => {
    expect(classifySwap(Asset.USD, Asset.NGN)).toBe("convert");
    expect(classifySwap(Asset.NGN, Asset.USD)).toBe("convert");
    expect(classifySwap(Asset.USD, Asset.BTC)).toBe("convert");
    expect(classifySwap(Asset.BTC, Asset.USD)).toBe("convert");
    expect(classifySwap(Asset.BTC, Asset.USDT)).toBe("convert");
  });
});

describe("isNgnUsdPair", () => {
  it("is true only for NGN↔USD in either direction", () => {
    expect(isNgnUsdPair(Asset.NGN, Asset.USD)).toBe(true);
    expect(isNgnUsdPair(Asset.USD, Asset.NGN)).toBe(true);
  });
  it("is false for any pair with a crypto leg", () => {
    expect(isNgnUsdPair(Asset.USD, Asset.BTC)).toBe(false);
    expect(isNgnUsdPair(Asset.NGN, Asset.USDT)).toBe(false);
    expect(isNgnUsdPair(Asset.BTC, Asset.USDT)).toBe(false);
  });
});

describe("computeCryptoConvert with fiat legs", () => {
  // usdtNgnRate 2000, so NGN price = 0.0005 USDT/NGN, USD price = 1.
  const ngn = fiatUsdtPrice(Asset.NGN, D("2000"))!;
  const usd = fiatUsdtPrice(Asset.USD, D("2000"))!;

  it("USD → NGN: 100 USD becomes ₦200,000 (no spread)", () => {
    const r = computeCryptoConvert({
      fromAsset: Asset.USD,
      toAsset: Asset.NGN,
      amountInMinor: 10_000n, // $100.00
      fromUsdtPrice: usd,
      toUsdtPrice: ngn,
      spreadBps: 0,
    });
    expect(r.amountOutMinor).toBe(20_000_000n); // ₦200,000 in kobo
  });

  it("NGN → USD: ₦200,000 becomes $100 (no spread)", () => {
    const r = computeCryptoConvert({
      fromAsset: Asset.NGN,
      toAsset: Asset.USD,
      amountInMinor: 20_000_000n, // ₦200,000
      fromUsdtPrice: ngn,
      toUsdtPrice: usd,
      spreadBps: 0,
    });
    expect(r.amountOutMinor).toBe(10_000n); // $100.00
  });

  it("USD → BTC at 60,000 USDT/BTC: $60,000 becomes 1 BTC", () => {
    const r = computeCryptoConvert({
      fromAsset: Asset.USD,
      toAsset: Asset.BTC,
      amountInMinor: 6_000_000n, // $60,000.00
      fromUsdtPrice: usd,
      toUsdtPrice: D("60000"),
      spreadBps: 0,
    });
    expect(r.amountOutMinor).toBe(100_000_000n); // 1 BTC (8dp)
  });

  it("applies the spread once on a USD → NGN convert", () => {
    // 1% spread: 100 USD → 200,000 * 0.99 = ₦198,000
    const r = computeCryptoConvert({
      fromAsset: Asset.USD,
      toAsset: Asset.NGN,
      amountInMinor: 10_000n,
      fromUsdtPrice: usd,
      toUsdtPrice: ngn,
      spreadBps: 100,
    });
    expect(r.amountOutMinor).toBe(19_800_000n); // ₦198,000
  });
});

describe("computeCryptoConvert fee", () => {
  const ngn = fiatUsdtPrice(Asset.NGN, D("2000"))!;
  const usd = fiatUsdtPrice(Asset.USD, D("2000"))!;

  it("reports what the spread cost, in the asset received", () => {
    // $100 → NGN at ₦2,000/$ is ₦200,000 gross; a 1% spread keeps ₦2,000.
    const r = computeCryptoConvert({
      fromAsset: Asset.USD,
      toAsset: Asset.NGN,
      amountInMinor: 10_000n,
      fromUsdtPrice: usd,
      toUsdtPrice: ngn,
      spreadBps: 100,
    });
    expect(r.amountOutMinor).toBe(19_800_000n);
    expect(r.feeOutMinor).toBe(200_000n);
    expect(r.amountOutMinor + r.feeOutMinor).toBe(20_000_000n);
  });

  it("is zero with no spread", () => {
    const r = computeCryptoConvert({
      fromAsset: Asset.USD,
      toAsset: Asset.NGN,
      amountInMinor: 10_000n,
      fromUsdtPrice: usd,
      toUsdtPrice: ngn,
      spreadBps: 0,
    });
    expect(r.feeOutMinor).toBe(0n);
  });
});

describe("floorOutToMinMarginNgn", () => {
  // A sell: out asset is NGN, so one whole out unit is worth ₦1.
  it("widens a thin sell margin up to the flat floor (out = NGN)", () => {
    // Mid value ₦1,000 (100,000 kobo); spread kept only ₦5 (net 99,500 kobo).
    // Floor ₦15 must cut the net to 98,500 kobo so we keep ₦15.
    const net = floorOutToMinMarginNgn({
      grossOutMinor: 100_000n,
      netOutMinor: 99_500n,
      outAsset: Asset.NGN,
      ngnPerOutWhole: D(1),
      minMarginNgn: 15,
    });
    expect(net).toBe(98_500n); // gross − ₦15
  });

  it("leaves a sell alone when the spread already clears the floor", () => {
    // Spread already kept ₦30 (net 97,000 kobo) — above the ₦15 floor.
    const net = floorOutToMinMarginNgn({
      grossOutMinor: 100_000n,
      netOutMinor: 97_000n,
      outAsset: Asset.NGN,
      ngnPerOutWhole: D(1),
      minMarginNgn: 15,
    });
    expect(net).toBe(97_000n);
  });

  it("widens a thin buy margin, converting ₦15 into the out coin (out = USDT)", () => {
    // 1 USDT costs ₦1,500 at mid. Gross 10 USDT = 10,000,000 minor; spread kept
    // ₦3 worth. The ₦15 floor = 0.01 USDT = 10,000 minor, so net = gross − that.
    const net = floorOutToMinMarginNgn({
      grossOutMinor: 10_000_000n,
      netOutMinor: 9_998_000n, // ~₦3 of margin
      outAsset: Asset.USDT,
      ngnPerOutWhole: D(1500),
      minMarginNgn: 15,
    });
    expect(net).toBe(9_990_000n); // 10,000,000 − 10,000 (= 0.01 USDT = ₦15)
  });

  it("is a no-op when the floor is 0 (disabled)", () => {
    const net = floorOutToMinMarginNgn({
      grossOutMinor: 100_000n,
      netOutMinor: 99_990n,
      outAsset: Asset.NGN,
      ngnPerOutWhole: D(1),
      minMarginNgn: 0,
    });
    expect(net).toBe(99_990n);
  });

  it("can drive a tiny trade's payout to zero or below (caller rejects as dust)", () => {
    // Gross only ₦10 (1,000 kobo) but the floor wants ₦15 → net goes negative.
    const net = floorOutToMinMarginNgn({
      grossOutMinor: 1_000n,
      netOutMinor: 950n,
      outAsset: Asset.NGN,
      ngnPerOutWhole: D(1),
      minMarginNgn: 15,
    });
    expect(net).toBeLessThanOrEqual(0n);
  });
});
