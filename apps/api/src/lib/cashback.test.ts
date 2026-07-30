import { describe, expect, it } from "vitest";
import { cashbackAmountMinor, ngnLegFromSwapMetadata } from "./cashback";
import type { CashbackConfig } from "./settings";

const on: CashbackConfig = {
  enabled: true,
  depositBps: 100, // 1%
  withdrawalBps: 50, // 0.5%
  billBps: 200, // 2%
  tradeBps: 25, // 0.25%
  maxNgn: 0,
};

/** ₦1,000 in kobo. */
const NGN = (naira: number) => BigInt(naira * 100);

describe("cashbackAmountMinor", () => {
  it("pays nothing while cashback is switched off", () => {
    expect(cashbackAmountMinor(NGN(10_000), { ...on, enabled: false }, "deposit")).toBe(0n);
  });

  it("pays nothing when that kind's rate is 0", () => {
    expect(cashbackAmountMinor(NGN(10_000), { ...on, billBps: 0 }, "bill")).toBe(0n);
  });

  it("applies the rate for the matching kind", () => {
    // 1% of ₦10,000 = ₦100 = 10_000 kobo
    expect(cashbackAmountMinor(NGN(10_000), on, "deposit")).toBe(10_000n);
    // 0.5% of ₦10,000 = ₦50
    expect(cashbackAmountMinor(NGN(10_000), on, "withdrawal")).toBe(5_000n);
    // 2% of ₦10,000 = ₦200
    expect(cashbackAmountMinor(NGN(10_000), on, "bill")).toBe(20_000n);
    // 0.25% of ₦10,000 = ₦25
    expect(cashbackAmountMinor(NGN(10_000), on, "trade")).toBe(2_500n);
  });

  it("floors rather than rounding up, so a reward never over-pays", () => {
    // 1% of ₦1.99 (199 kobo) = 1.99 kobo -> 1 kobo
    expect(cashbackAmountMinor(199n, on, "deposit")).toBe(1n);
    // Sub-kobo rewards collapse to zero rather than becoming free money.
    expect(cashbackAmountMinor(50n, on, "deposit")).toBe(0n);
  });

  it("honours the per-transaction cap", () => {
    // 1% of ₦1,000,000 would be ₦10,000, capped at ₦500.
    const capped = cashbackAmountMinor(NGN(1_000_000), { ...on, maxNgn: 500 }, "deposit");
    expect(capped).toBe(NGN(500));
  });

  it("leaves rewards under the cap untouched", () => {
    const reward = cashbackAmountMinor(NGN(10_000), { ...on, maxNgn: 500 }, "deposit");
    expect(reward).toBe(NGN(100));
  });

  it("ignores zero and negative bases", () => {
    expect(cashbackAmountMinor(0n, on, "deposit")).toBe(0n);
    expect(cashbackAmountMinor(-5_000n, on, "deposit")).toBe(0n);
  });
});

describe("ngnLegFromSwapMetadata", () => {
  it("takes the NGN spent on a buy", () => {
    expect(
      ngnLegFromSwapMetadata({ fromAsset: "NGN", toAsset: "BTC", amountIn: "500000", amountOut: "1" })
    ).toBe(500_000n);
  });

  it("takes the NGN received on a sell", () => {
    expect(
      ngnLegFromSwapMetadata({ fromAsset: "BTC", toAsset: "NGN", amountIn: "1", amountOut: "750000" })
    ).toBe(750_000n);
  });

  it("returns nothing for a crypto-to-crypto convert", () => {
    expect(
      ngnLegFromSwapMetadata({ fromAsset: "BTC", toAsset: "USDT", amountIn: "1", amountOut: "2" })
    ).toBe(0n);
  });

  it("survives malformed metadata", () => {
    expect(ngnLegFromSwapMetadata(null)).toBe(0n);
    expect(ngnLegFromSwapMetadata("nonsense")).toBe(0n);
    expect(ngnLegFromSwapMetadata({ fromAsset: "NGN", amountIn: "not-a-number" })).toBe(0n);
  });
});
