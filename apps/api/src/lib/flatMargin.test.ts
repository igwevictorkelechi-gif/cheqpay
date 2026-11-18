import { beforeEach, describe, expect, it, vi } from "vitest";

// The owner's price sheet (18 Nov 2026): CheqPay keeps a flat ₦20 on every $1
// a customer buys or sells — USD, USDT, USDC and BTC alike — measured against
// what Maplerad really charges or pays for that dollar, on that side of the
// book. The numbers below are Maplerad's own from that day: it charged
// ~₦1,487 for a dollar (NGN→USD) and paid ~₦1,460 for one (USD→NGN).

const { RealDecimal } = vi.hoisted(() => ({
  RealDecimal: (require("@prisma/client") as typeof import("@prisma/client")).Prisma.Decimal,
}));

const h = vi.hoisted(() => ({
  quoteFindUnique: vi.fn(),
  quoteCreate: vi.fn(),
  txFindUnique: vi.fn(),
  txCreate: vi.fn(),
  auditCreate: vi.fn(),
  quoteUpdateMany: vi.fn(),
  balanceUpdateMany: vi.fn(),
  balanceUpsert: vi.fn(),
  balanceUpdate: vi.fn(),
  quoteFx: vi.fn(),
  exchangeFx: vi.fn(),
  providerBalance: vi.fn(),
  settlement: vi.fn(),
  spreadFor: vi.fn(),
  usdtNgnRate: vi.fn(),
  awardCashback: vi.fn(),
  notifyUser: vi.fn(),
  spot: vi.fn(),
  minMargin: vi.fn(),
}));

const db = {
  quote: { updateMany: h.quoteUpdateMany },
  balance: { updateMany: h.balanceUpdateMany, upsert: h.balanceUpsert, update: h.balanceUpdate },
  transaction: { create: h.txCreate },
  auditLog: { create: h.auditCreate },
};

// Nobody here owes an Ajo group; the lien itself is covered in lib/ajo/lien.test.ts.
vi.mock("@/lib/ajo/lien", () => ({ assertNoAjoArrears: vi.fn(async () => undefined), ajoArrearsKobo: vi.fn(async () => 0n) }));
vi.mock("@cheqpay/db", () => ({
  Asset: { NGN: "NGN", USD: "USD", BTC: "BTC", USDT: "USDT", USDC: "USDC" },
  TransactionStatus: { COMPLETED: "COMPLETED" },
  TransactionType: { CONVERT: "CONVERT", BUY: "BUY", SELL: "SELL" },
  Prisma: { Decimal: RealDecimal },
  prisma: {
    quote: { findUnique: h.quoteFindUnique, create: h.quoteCreate },
    transaction: { findUnique: h.txFindUnique },
    balance: { update: h.balanceUpdate },
    $transaction: (cb: (tx: typeof db) => unknown) => cb(db),
  },
}));
vi.mock("./kyc", () => ({ isWithinSingleTxLimit: () => true }));
vi.mock("./maplerad/fx", () => ({ quoteFx: h.quoteFx, exchangeFx: h.exchangeFx }));
vi.mock("./maplerad/treasury", () => ({ getProviderBalanceMinor: h.providerBalance }));
vi.mock("./ensureUsdAsset", () => ({ ensureUsdAsset: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./ensureQuoteProviderRef", () => ({ ensureQuoteProviderRef: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./settings", () => ({
  getCryptoSettlement: h.settlement,
  getSwapSpreadBpsFor: vi.fn().mockResolvedValue(200),
  getFxSideMarginBps: vi.fn().mockResolvedValue(178),
  getMinTradeMarginNgn: h.minMargin,
  getUsdtNgnRate: vi.fn().mockResolvedValue(1413),
  getTradeMarginNgnPerUsd: vi.fn().mockResolvedValue(20),
  getDollarBook: vi.fn().mockResolvedValue({ bid: 1460, ask: 1487, mid: 1473.5, source: "maplerad" }),
  feeFromBps: (amt: bigint, bps: number) => (bps <= 0 ? 0n : (amt * BigInt(Math.trunc(bps))) / 10_000n),
}));
vi.mock("./cashback", () => ({ awardCashback: h.awardCashback }));
vi.mock("./alerts", () => ({ notifyUser: h.notifyUser }));
vi.mock("./opsAlert", () => ({ alertOpsOnce: vi.fn() }));
vi.mock("@/market", () => ({ getPriceFeed: () => ({ getSpotUsdt: h.spot }) }));

import { createConvertQuote, createQuote, executeSwap } from "./swap";
import { netOutAfterFlatMargin } from "./rates";

function reset() {
  Object.values(h).forEach((fn) => fn.mockReset());
  h.settlement.mockResolvedValue("maplerad");
  h.providerBalance.mockResolvedValue(null);
  h.minMargin.mockResolvedValue(15);
  h.spot.mockImplementation((asset: string) => Promise.resolve(new RealDecimal(asset === "BTC" ? 100_000 : 1)));
  h.quoteCreate.mockImplementation(({ data }: { data: object }) => Promise.resolve({ id: "q1", ...data }));
}

/** Maplerad's answer to a quote: `amount` in, `out` back, both in kobo/cents. */
const fx = (from: string, amount: number, to: string, out: number) => ({
  reference: "fxref",
  source: { currency: from, amount },
  target: { currency: to, amount: out },
  rate: 0,
});

/** Naira per $1 the customer actually got, from the two legs. */
const ngnPerUsd = (kobo: bigint, dollarMinor: bigint, decimals: number) =>
  Number(kobo) / 100 / (Number(dollarMinor) / 10 ** decimals);

describe("₦20 per $1, on Maplerad's real rate for each side", () => {
  beforeEach(reset);

  it("a customer buying USD pays Maplerad's NGN→USD rate plus ₦20", async () => {
    // The failed customer's own amount: ₦9,500, which Maplerad prices at $6.39 (₦1,486.70).
    h.quoteFx.mockResolvedValue(fx("NGN", 950_000, "USD", 639));
    const q = await createConvertQuote({ userId: "u1", tier: 2, fromAsset: "NGN" as never, toAsset: "USD" as never, amountInMinor: 950_000n });

    expect(q.amountOut).toBe(630n); // $6.30
    expect(ngnPerUsd(q.amountIn, q.amountOut, 2)).toBeCloseTo(1507.94, 2); // 1,486.70 + 20, to the cent
    expect(q.marginNgnPerUsd).toBe(20);
    // We exchange all ₦9,500 and keep the 9¢ left over — never less than ₦20 × $6.30.
    expect(Number(q.marginMinor) / 100 * 1486.7).toBeGreaterThanOrEqual(20 * 6.3);
  });

  it("a customer selling USD gets Maplerad's USD→NGN rate less ₦20", async () => {
    h.quoteFx.mockResolvedValue(fx("USD", 1_000, "NGN", 1_460_000)); // $10 → ₦14,600
    const q = await createConvertQuote({ userId: "u1", tier: 2, fromAsset: "USD" as never, toAsset: "NGN" as never, amountInMinor: 1_000n });

    expect(q.amountOut).toBe(1_440_000n); // ₦14,400 = ₦1,440 per $1
    expect(q.marginMinor).toBe(20_000n); // ₦200 kept = ₦20 × $10
  });

  it("USDT bought with naira: ₦1,487 + ₦20 = ₦1,507 per coin", async () => {
    h.quoteFx.mockResolvedValue(fx("NGN", 1_487_000, "USD", 1_000)); // ₦14,870 → $10.00
    const q = await createQuote({ userId: "u1", tier: 2, side: "buy", cryptoAsset: "USDT" as never, amountInMinor: 1_487_000n });

    expect(q.amountOut).toBe(9_867_285n); // 9.867285 USDT
    expect(Number(q.rate)).toBeCloseTo(1507, 2); // stored as naira per coin
  });

  it("USDC sold for naira: ₦1,460 − ₦20 = ₦1,440 per coin", async () => {
    h.quoteFx.mockResolvedValue(fx("USD", 1_000, "NGN", 1_460_000));
    const q = await createQuote({ userId: "u1", tier: 2, side: "sell", cryptoAsset: "USDC" as never, amountInMinor: 10_000_000n });

    expect(q.amountOut).toBe(1_440_000n);
  });

  it("BTC bought: priced off what a dollar costs us, plus ₦20", async () => {
    // BTC at $100,000; the customer's dollar costs ₦1,487 + ₦20 = ₦1,507.
    const q = await createQuote({ userId: "u1", tier: 2, side: "buy", cryptoAsset: "BTC" as never, amountInMinor: 150_700_000n });

    expect(q.amountOut).toBe(1_000_000n); // 0.01 BTC for ₦1,507,000
    expect(h.quoteFx).not.toHaveBeenCalled(); // BTC is on our own books
    // At cost (₦1,487) the same naira is 0.01013450 BTC; the rest is ours: ₦20 × $1,000.
    expect(q.marginMinor).toBe(13_449n);
  });

  it("BTC sold: priced off what a dollar fetches, less ₦20", async () => {
    const q = await createQuote({ userId: "u1", tier: 2, side: "sell", cryptoAsset: "BTC" as never, amountInMinor: 1_000_000n });

    expect(q.amountOut).toBe(144_000_000n); // ₦1,440,000 = $1,000 × ₦1,440
    expect(q.marginMinor).toBe(2_000_000n); // ₦20,000 = ₦20 × $1,000
  });

  it("the Convert screen quotes BTC → naira exactly as the Sell sheet does", async () => {
    const q = await createConvertQuote({ userId: "u1", tier: 2, fromAsset: "BTC" as never, toAsset: "NGN" as never, amountInMinor: 1_000_000n });
    expect(q.amountOut).toBe(144_000_000n);
    expect(q.feeOutMinor).toBe(2_000_000n);
  });

  it("buying always costs more than selling pays, so no round trip makes money off us", async () => {
    h.quoteFx.mockResolvedValueOnce(fx("NGN", 1_487_000, "USD", 1_000));
    const buy = await createQuote({ userId: "u1", tier: 2, side: "buy", cryptoAsset: "USDT" as never, amountInMinor: 1_487_000n });
    h.quoteFx.mockResolvedValueOnce(fx("USD", 986, "NGN", 1_439_560));
    const sell = await createQuote({ userId: "u1", tier: 2, side: "sell", cryptoAsset: "USDT" as never, amountInMinor: buy.amountOut });
    expect(sell.amountOut).toBeLessThan(buy.amountIn);
  });

  it("keeps the ₦15 per-trade floor on a tiny trade", async () => {
    h.quoteFx.mockResolvedValue(fx("USD", 50, "NGN", 73_000)); // $0.50 → ₦730; ₦20/$ would keep only ₦10
    const q = await createQuote({ userId: "u1", tier: 2, side: "sell", cryptoAsset: "USDT" as never, amountInMinor: 500_000n });
    expect(q.amountOut).toBe(71_500n); // ₦715: the ₦15 floor
  });

  it("settles at the same ₦20 and records the margin it kept", async () => {
    h.quoteFindUnique.mockResolvedValue({
      id: "q1", userId: "u1", fromAsset: "USD", toAsset: "NGN", amountIn: 1_000n, amountOut: 1_440_000n,
      rate: new RealDecimal(1440), consumed: false, providerRef: "fxref", marginMinor: 20_000n,
      expiresAt: new Date(Date.now() + 30_000),
    });
    h.txFindUnique.mockResolvedValue(null);
    h.quoteUpdateMany.mockResolvedValue({ count: 1 });
    h.balanceUpdateMany.mockResolvedValue({ count: 1 });
    h.exchangeFx.mockResolvedValue(fx("USD", 1_000, "NGN", 1_460_000));
    h.txCreate.mockImplementation(({ data }: { data: object }) => Promise.resolve({ id: "t1", status: "COMPLETED", ...data }));

    await executeSwap({ userId: "u1", quoteId: "q1", idempotencyKey: "k1" });

    expect(h.balanceUpsert).toHaveBeenCalledWith(expect.objectContaining({ update: { available: { increment: 1_440_000n } } }));
    const meta = h.txCreate.mock.calls[0][0].data.metadata;
    expect(meta.spreadMinor).toBe("20000");
    expect(meta.marginNgnPerUsd).toBe(20);
  });
});

describe("when Maplerad refuses the exchange itself", () => {
  beforeEach(reset);

  it("refunds the customer and says which way still works", async () => {
    // What happened on 18 Nov 2026: the quote went through, the exchange did not.
    h.quoteFindUnique.mockResolvedValue({
      id: "q1", userId: "u1", fromAsset: "NGN", toAsset: "USD", amountIn: 950_000n, amountOut: 630n,
      rate: new RealDecimal(0.00066), consumed: false, providerRef: "fxref", marginMinor: 9n,
      expiresAt: new Date(Date.now() + 30_000),
    });
    h.txFindUnique.mockResolvedValue(null);
    h.quoteUpdateMany.mockResolvedValue({ count: 1 });
    h.balanceUpdateMany.mockResolvedValue({ count: 1 });
    h.balanceUpdate.mockResolvedValue({});
    const { MapleradError } = await import("./maplerad/client");
    h.exchangeFx.mockRejectedValue(new MapleradError("NGN exchanges are not enabled for this business", 400, null));

    await expect(executeSwap({ userId: "u1", quoteId: "q1", idempotencyKey: "k1" })).rejects.toMatchObject({
      code: "fx_direction_unavailable",
      message: "Converting naira to dollars isn't available right now. You can still convert dollars to naira. Nothing was charged.",
    });
    expect(h.balanceUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { available: { increment: 950_000n } } }));
    expect(h.txCreate).not.toHaveBeenCalled();
  });
});

describe("netOutAfterFlatMargin", () => {
  it("is the provider's own amount at a margin of 0", () => {
    expect(netOutAfterFlatMargin({ fromAsset: "NGN" as never, toAsset: "USD" as never, amountInMinor: 950_000n, grossOutMinor: 639n, marginNgnPerUsd: 0 })).toBe(639n);
  });

  it("rounds against the customer, never for them", () => {
    // $0.01 sold: ₦0.20 margin is 20 kobo exactly; $0.015 of USDT rounds the kobo up.
    expect(netOutAfterFlatMargin({ fromAsset: "USDT" as never, toAsset: "NGN" as never, amountInMinor: 15_000n, grossOutMinor: 2_190n, marginNgnPerUsd: 20 })).toBe(2_160n);
  });
});
