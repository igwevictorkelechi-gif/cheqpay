import { describe, expect, it } from "vitest";
import { Prisma } from "@cheqpay/db";
import {
  cardFundFee,
  cardIssueFee,
  cardWithdrawFee,
  cryptoDepositFee,
  feeInclusiveSplit,
  ngnDepositFee,
  usdDepositFee,
  usdFeeInCoin,
  withdrawalBreakdown,
} from "./fees";
import { PRICING_DEFAULTS as P } from "./settings";

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

describe("the price sheet", () => {
  it("caps the NGN deposit fee", () => {
    expect(ngnDepositFee(NGN(10_000), 75, 800)).toBe(7_500n); // ₦75
    expect(ngnDepositFee(NGN(1_000_000), 75, 800)).toBe(NGN(800)); // capped
    expect(ngnDepositFee(NGN(1_000_000), 75, 0)).toBe(NGN(7_500)); // 0 = no cap
  });

  it("prices USD deposits in two tiers", () => {
    expect(usdDepositFee(100_00n, P)).toBe(3_50n); // $100 → 3.5%
    expect(usdDepositFee(24_999_99n, P)).toBe(874_99n); // just under → 3.5%
    expect(usdDepositFee(25_000_00n, P)).toBe(500_00n); // $25k → 2%
  });

  it("charges 1% on stablecoins that land as USD", () => {
    expect(cryptoDepositFee(50_00n, P)).toBe(50n);
  });

  it("prices card funding: $5 minimum, flat below $100, percentage from it", () => {
    expect(() => cardFundFee(4_99n, P)).toThrow(/smallest card top-up/);
    expect(cardFundFee(5_00n, P)).toBe(1_50n);
    expect(cardFundFee(99_99n, P)).toBe(1_50n);
    expect(cardFundFee(100_00n, P)).toBe(2_50n);
    expect(cardFundFee(1_000_00n, P)).toBe(25_00n);
  });

  it("prices a card at $3 and a card withdrawal at $1.50", () => {
    expect(cardIssueFee(P)).toBe(3_00n);
    expect(cardWithdrawFee(P)).toBe(1_50n);
  });

  it("converts a dollar fee into coin, rounding up", () => {
    // $2.50 of USDT at $1 = 2.5 USDT (6dp).
    expect(usdFeeInCoin(2.5, "USDT" as never, new Prisma.Decimal(1))).toBe(2_500_000n);
    // $2.50 of BTC at $60,000 = 0.0000416666… → 4167 sats, never 4166.
    expect(usdFeeInCoin(2.5, "BTC" as never, new Prisma.Decimal(60_000))).toBe(4_167n);
    expect(usdFeeInCoin(0, "BTC" as never, new Prisma.Decimal(60_000))).toBe(0n);
  });

  it("splits a typed amount so the fee comes out of it", () => {
    expect(feeInclusiveSplit(10n, 3n, "network")).toEqual({ grossMinor: 10n, feeMinor: 3n, netMinor: 7n });
    expect(() => feeInclusiveSplit(3n, 3n, "network")).toThrow(/doesn't cover the network fee/);
  });
});
