import { beforeEach, describe, expect, it, vi } from "vitest";

// The real Decimal, not a stub: the rate a NGN↔USD quote stores is now computed
// from the two legs with Decimal arithmetic, so a stub that only carries a
// string would test nothing about the number that reaches the user.
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
  isWithinSingleTxLimit: vi.fn(),
  notifyUser: vi.fn(),
  getFxSideMarginBps: vi.fn(),
  providerBalance: vi.fn(),
}));

const db = {
  quote: { updateMany: h.quoteUpdateMany },
  balance: { updateMany: h.balanceUpdateMany, upsert: h.balanceUpsert, update: h.balanceUpdate },
  transaction: { create: h.txCreate },
  auditLog: { create: h.auditCreate },
};

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
vi.mock("./kyc", () => ({ isWithinSingleTxLimit: h.isWithinSingleTxLimit }));
vi.mock("./maplerad/fx", () => ({ quoteFx: h.quoteFx, exchangeFx: h.exchangeFx }));
vi.mock("./maplerad/treasury", () => ({ getProviderBalanceMinor: h.providerBalance }));
vi.mock("./ensureUsdAsset", () => ({ ensureUsdAsset: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./ensureQuoteProviderRef", () => ({ ensureQuoteProviderRef: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./settings", () => ({
  getUsdtNgnRate: vi.fn(),
  getSwapSpreadBps: vi.fn(),
  getFxSideMarginBps: h.getFxSideMarginBps,
  // The real implementation: the arithmetic is the thing under test.
  feeFromBps: (amt: bigint, bps: number) =>
    bps <= 0 ? 0n : (amt * BigInt(Math.trunc(bps))) / 10_000n,
}));
vi.mock("./cashback", () => ({ awardCashback: vi.fn() }));
vi.mock("./alerts", () => ({ notifyUser: h.notifyUser }));
vi.mock("@/market", () => ({ getPriceFeed: () => ({ getSpotUsdt: vi.fn() }) }));

import { createConvertQuote, executeSwap } from "./swap";

const fxQuote = {
  id: "q1",
  userId: "u1",
  fromAsset: "NGN",
  toAsset: "USD",
  amountIn: 1_000_000n, // ₦10,000
  amountOut: 660n, // $6.60
  rate: { toString: () => "0.00066" },
  providerRef: "fxref",
  consumed: false,
  expiresAt: new Date(Date.now() + 60_000),
};

describe("createConvertQuote — NGN↔USD routes to Maplerad FX", () => {
  beforeEach(() => {
    Object.values(h).forEach((fn) => fn.mockReset());
    h.isWithinSingleTxLimit.mockReturnValue(true);
    h.quoteCreate.mockResolvedValue({ id: "q1" });
    h.getFxSideMarginBps.mockResolvedValue(0);
    h.providerBalance.mockResolvedValue(null);
  });

  it("refuses at quote time when our business wallet can't cover the swap", async () => {
    // The live case: $167.01 asked, the business USD wallet held less.
    h.providerBalance.mockResolvedValue(16_100n);
    await expect(
      createConvertQuote({ userId: "u1", tier: 2, fromAsset: "USD" as never, toAsset: "NGN" as never, amountInMinor: 16_701n }),
    ).rejects.toMatchObject({ status: 503, code: "liquidity_low" });
    expect(h.quoteFx).not.toHaveBeenCalled();
    expect(h.providerBalance).toHaveBeenCalledWith("USD");
  });

  it("quotes normally when the business wallet covers it, or can't be read", async () => {
    const fx = {
      reference: "fxref",
      source: { currency: "USD", amount: 16_100, human_readable_amount: 161 },
      target: { currency: "NGN", amount: 21_976_500, human_readable_amount: 219_765 },
      rate: 1365,
    };
    h.quoteFx.mockResolvedValue(fx);
    h.providerBalance.mockResolvedValue(16_100n);
    await createConvertQuote({ userId: "u1", tier: 2, fromAsset: "USD" as never, toAsset: "NGN" as never, amountInMinor: 16_100n });
    h.providerBalance.mockResolvedValue(null);
    await createConvertQuote({ userId: "u1", tier: 2, fromAsset: "USD" as never, toAsset: "NGN" as never, amountInMinor: 16_100n });
    expect(h.quoteFx).toHaveBeenCalledTimes(2);
  });

  it("prices from a live FX quote and stores the provider reference", async () => {
    h.quoteFx.mockResolvedValue({
      reference: "fxref",
      source: { currency: "NGN", amount: 1_000_000, human_readable_amount: 10000 },
      target: { currency: "USD", amount: 660, human_readable_amount: 6.6 },
      rate: 0.00066,
    });

    await createConvertQuote({ userId: "u1", tier: 2, fromAsset: "NGN" as never, toAsset: "USD" as never, amountInMinor: 1_000_000n });

    expect(h.quoteFx).toHaveBeenCalledWith({ sourceCurrency: "NGN", targetCurrency: "USD", amount: 1_000_000 });
    const data = h.quoteCreate.mock.calls[0][0].data;
    expect(data.providerRef).toBe("fxref");
    expect(data.amountOut).toBe(660n);
  });

  it("stores the rate as TO per FROM, derived from the legs — not Maplerad's own field", async () => {
    // Maplerad's `rate` here is quoted the OTHER way round (NGN per USD). Trusting
    // it would put 1,515 into a field the clients read as "USD per naira" and
    // print a conversion rate roughly two million times the real one.
    h.quoteFx.mockResolvedValue({
      reference: "fxref",
      source: { currency: "NGN", amount: 1_000_000, human_readable_amount: 10000 },
      target: { currency: "USD", amount: 660, human_readable_amount: 6.6 },
      rate: 1515.15,
    });

    await createConvertQuote({ userId: "u1", tier: 2, fromAsset: "NGN" as never, toAsset: "USD" as never, amountInMinor: 1_000_000n });

    // $6.60 for ₦10,000 = 0.00066 USD per naira.
    const rate = Number(h.quoteCreate.mock.calls[0][0].data.rate.toString());
    expect(rate).toBeCloseTo(0.00066, 8);
  });

  it("derives the reverse direction just as correctly", async () => {
    h.quoteFx.mockResolvedValue({
      reference: "fxref2",
      source: { currency: "USD", amount: 10_000, human_readable_amount: 100 },
      target: { currency: "NGN", amount: 15_000_000, human_readable_amount: 150000 },
      rate: 0.00066,
    });

    await createConvertQuote({ userId: "u1", tier: 2, fromAsset: "USD" as never, toAsset: "NGN" as never, amountInMinor: 10_000n });

    // ₦150,000 for $100 = ₦1,500 per dollar.
    const rate = Number(h.quoteCreate.mock.calls[0][0].data.rate.toString());
    expect(rate).toBeCloseTo(1500, 6);
  });

  it("refuses a quote the provider priced at nothing rather than storing a zero rate", async () => {
    h.quoteFx.mockResolvedValue({
      reference: "fxref3",
      source: { currency: "NGN", amount: 1_000_000, human_readable_amount: 10000 },
      target: { currency: "USD", amount: 0, human_readable_amount: 0 },
      rate: 0,
    });

    await expect(
      createConvertQuote({ userId: "u1", tier: 2, fromAsset: "NGN" as never, toAsset: "USD" as never, amountInMinor: 1_000_000n }),
    ).rejects.toMatchObject({ code: "bad_fx_quote" });
    expect(h.quoteCreate).not.toHaveBeenCalled();
  });
});

describe("executeSwap — NGN↔USD settles on the real FX rail", () => {
  beforeEach(() => {
    Object.values(h).forEach((fn) => fn.mockReset());
    h.quoteFindUnique.mockResolvedValue(fxQuote);
    h.txFindUnique.mockResolvedValue(null);
    h.quoteUpdateMany.mockResolvedValue({ count: 1 });
    h.balanceUpdateMany.mockResolvedValue({ count: 1 });
    h.balanceUpsert.mockResolvedValue({});
    h.balanceUpdate.mockResolvedValue({});
    h.txCreate.mockResolvedValue({ id: "tx1", status: "COMPLETED" });
    h.auditCreate.mockResolvedValue({});
    h.exchangeFx.mockResolvedValue({ source: {}, target: {}, rate: 600 });
    h.notifyUser.mockResolvedValue(undefined);
    h.getFxSideMarginBps.mockResolvedValue(0);
  });

  it("reserves, exchanges, then credits — recording a maplerad_fx CONVERT", async () => {
    const r = await executeSwap({ userId: "u1", quoteId: "q1", idempotencyKey: "idem-1" });

    expect(h.exchangeFx).toHaveBeenCalledWith({ quoteReference: "fxref" });
    // Debit the NGN in, credit the USD out.
    expect(h.balanceUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ asset: "NGN" }) }),
    );
    expect(h.balanceUpsert).toHaveBeenCalledWith(expect.objectContaining({ where: { userId_asset: { userId: "u1", asset: "USD" } } }));
    const txData = h.txCreate.mock.calls[0][0].data;
    expect(txData.type).toBe("CONVERT");
    expect(txData.metadata.rail).toBe("maplerad_fx");
    expect(r).toEqual({ transactionId: "tx1", status: "COMPLETED" });
  });

  it("refunds the reservation and does not credit when the exchange fails", async () => {
    h.exchangeFx.mockRejectedValue(new Error("provider down"));

    await expect(executeSwap({ userId: "u1", quoteId: "q1", idempotencyKey: "idem-2" })).rejects.toMatchObject({
      code: "fx_failed",
    });

    // The reservation was undone (increment back the NGN in), and no credit/record happened.
    expect(h.balanceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_asset: { userId: "u1", asset: "NGN" } },
        data: { available: { increment: 1_000_000n } },
      }),
    );
    expect(h.txCreate).not.toHaveBeenCalled();
  });

  it("aborts before touching the provider when the payer is short", async () => {
    h.balanceUpdateMany.mockResolvedValue({ count: 0 });

    await expect(executeSwap({ userId: "u1", quoteId: "q1", idempotencyKey: "idem-3" })).rejects.toMatchObject({
      code: "insufficient_funds",
    });
    expect(h.exchangeFx).not.toHaveBeenCalled();
  });

  it("credits what the exchange actually settled, not what the quote promised", async () => {
    // The provider settled at $6.50, sixpence short of the quoted $6.60.
    h.exchangeFx.mockResolvedValue({
      source: { currency: "NGN", amount: 1_000_000 },
      target: { currency: "USD", amount: 650 },
      rate: 0.00065,
    });

    await executeSwap({ userId: "u1", quoteId: "q1", idempotencyKey: "idem-settle" });

    expect(h.balanceUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { available: { increment: 650n } } }),
    );
    // Both figures are kept so the drift is visible on the transaction itself.
    const meta = h.txCreate.mock.calls[0][0].data.metadata;
    expect(meta.amountOut).toBe("650");
    expect(meta.quotedAmountOut).toBe("660");
  });

  it("falls back to the quoted amount when the exchange reports none", async () => {
    h.exchangeFx.mockResolvedValue({ source: {}, target: {}, rate: 600 });

    await executeSwap({ userId: "u1", quoteId: "q1", idempotencyKey: "idem-nofigure" });

    expect(h.balanceUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { available: { increment: 660n } } }),
    );
  });

  it("short-circuits on a replayed idempotency key without re-exchanging", async () => {
    h.txFindUnique.mockResolvedValue({ id: "tx-old", status: "COMPLETED" });
    const r = await executeSwap({ userId: "u1", quoteId: "q1", idempotencyKey: "idem-1" });
    expect(r).toEqual({ transactionId: "tx-old", status: "COMPLETED" });
    expect(h.exchangeFx).not.toHaveBeenCalled();
  });
});

describe("the NGN↔USD business spread", () => {
  beforeEach(() => {
    Object.values(h).forEach((fn) => fn.mockReset());
    h.isWithinSingleTxLimit.mockReturnValue(true);
    h.quoteCreate.mockResolvedValue({ id: "q1" });
    h.quoteFindUnique.mockResolvedValue(fxQuote);
    h.txFindUnique.mockResolvedValue(null);
    h.quoteUpdateMany.mockResolvedValue({ count: 1 });
    h.balanceUpdateMany.mockResolvedValue({ count: 1 });
    h.balanceUpsert.mockResolvedValue({});
    h.balanceUpdate.mockResolvedValue({});
    h.txCreate.mockResolvedValue({ id: "tx1", status: "COMPLETED" });
    h.auditCreate.mockResolvedValue({});
    h.notifyUser.mockResolvedValue(undefined);
    h.getFxSideMarginBps.mockResolvedValue(100); // 1% both sides
  });

  const providerQuote = (targetAmount: number) => ({
    reference: "fxref",
    source: { currency: "NGN", amount: 1_000_000, human_readable_amount: 10000 },
    target: { currency: "USD", amount: targetAmount, human_readable_amount: targetAmount / 100 },
    rate: 0.00066,
  });

  it("withholds the spread from what the provider quotes", async () => {
    h.quoteFx.mockResolvedValue(providerQuote(1_000)); // $10.00 gross
    await createConvertQuote({
      userId: "u1", tier: 2, fromAsset: "NGN" as never, toAsset: "USD" as never,
      amountInMinor: 1_000_000n,
    });
    // 1% of $10.00 is $0.10, so the user is promised $9.90.
    expect(h.quoteCreate.mock.calls[0][0].data.amountOut).toBe(990n);
  });

  it("prices the rate off the net, so the displayed rate is the one the user gets", async () => {
    h.quoteFx.mockResolvedValue(providerQuote(1_000));
    await createConvertQuote({
      userId: "u1", tier: 2, fromAsset: "NGN" as never, toAsset: "USD" as never,
      amountInMinor: 1_000_000n,
    });
    // $9.90 for ₦10,000 = 0.00099 USD per naira, not the gross 0.001.
    const rate = Number(h.quoteCreate.mock.calls[0][0].data.rate.toString());
    expect(rate).toBeCloseTo(0.00099, 8);
  });

  it("takes the spread again at settlement, so it is not handed back", async () => {
    // The regression this guards: executeFxSwap prefers the SETTLED amount over
    // the quoted one. Crediting that raw would return the whole margin.
    h.exchangeFx.mockResolvedValue({
      source: { currency: "NGN", amount: 1_000_000 },
      target: { currency: "USD", amount: 1_000 }, // $10.00 gross settled
      rate: 0.0001,
    });
    await executeSwap({ userId: "u1", quoteId: "q1", idempotencyKey: "idem-m1" });

    expect(h.balanceUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { available: { increment: 990n } } }),
    );
  });

  it("still credits what settled when the provider moves, net of the spread", async () => {
    // Settled $9.00 rather than the $10.00 quoted: the user gets 99% of what
    // actually exists, not 99% of what was hoped for.
    h.exchangeFx.mockResolvedValue({
      source: { currency: "NGN", amount: 1_000_000 },
      target: { currency: "USD", amount: 900 },
      rate: 0.0001,
    });
    await executeSwap({ userId: "u1", quoteId: "q1", idempotencyKey: "idem-m2" });

    expect(h.balanceUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { available: { increment: 891n } } }),
    );
  });

  it("falls back to the quoted net when the provider reports no amount", async () => {
    h.exchangeFx.mockResolvedValue({ source: {}, target: {}, rate: 600 });
    await executeSwap({ userId: "u1", quoteId: "q1", idempotencyKey: "idem-m3" });
    // fxQuote.amountOut is already net — do not take the spread off it twice.
    expect(h.balanceUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { available: { increment: 660n } } }),
    );
  });

  it("refuses a conversion too small to survive the spread", async () => {
    h.quoteFx.mockResolvedValue(providerQuote(0));
    await expect(
      createConvertQuote({
        userId: "u1", tier: 2, fromAsset: "NGN" as never, toAsset: "USD" as never,
        amountInMinor: 100n,
      }),
    ).rejects.toMatchObject({ code: "bad_fx_quote" });
  });

  it("changes nothing when the spread is off", async () => {
    h.getFxSideMarginBps.mockResolvedValue(0);
    h.quoteFx.mockResolvedValue(providerQuote(1_000));
    await createConvertQuote({
      userId: "u1", tier: 2, fromAsset: "NGN" as never, toAsset: "USD" as never,
      amountInMinor: 1_000_000n,
    });
    expect(h.quoteCreate.mock.calls[0][0].data.amountOut).toBe(1_000n);
  });
});

describe("the book is two-sided — dollars leave dearer than they arrive", () => {
  // The live configuration: 0.75% when we buy dollars, 1.5% when we sell them.
  const BUY_USD = 75;
  const SELL_USD = 150;

  beforeEach(() => {
    Object.values(h).forEach((fn) => fn.mockReset());
    h.isWithinSingleTxLimit.mockReturnValue(true);
    h.quoteCreate.mockResolvedValue({ id: "q1" });
    h.getFxSideMarginBps.mockImplementation(async (side: string) =>
      side === "sell_usd" ? SELL_USD : BUY_USD,
    );
  });

  it("charges the sell-side rate when the user buys dollars with naira", async () => {
    // ₦10,000 at a ₦1,600 mid is $6.25 gross.
    h.quoteFx.mockResolvedValue({
      reference: "fxref",
      source: { currency: "NGN", amount: 1_000_000 },
      target: { currency: "USD", amount: 625 },
      rate: 0.000625,
    });

    await createConvertQuote({
      userId: "u1", tier: 2, fromAsset: "NGN" as never, toAsset: "USD" as never,
      amountInMinor: 1_000_000n,
    });

    expect(h.getFxSideMarginBps).toHaveBeenCalledWith("sell_usd");
    // 1.5% of 625 cents is 9.375, floored to 9.
    expect(h.quoteCreate.mock.calls[0][0].data.amountOut).toBe(616n);
  });

  it("charges the buy-side rate when the user sells dollars for naira", async () => {
    // $100 at a ₦1,600 mid is ₦160,000 gross.
    h.quoteFx.mockResolvedValue({
      reference: "fxref",
      source: { currency: "USD", amount: 10_000 },
      target: { currency: "NGN", amount: 16_000_000 },
      rate: 1600,
    });

    await createConvertQuote({
      userId: "u1", tier: 2, fromAsset: "USD" as never, toAsset: "NGN" as never,
      amountInMinor: 10_000n,
    });

    expect(h.getFxSideMarginBps).toHaveBeenCalledWith("buy_usd");
    // 0.75% of ₦160,000 is ₦1,200 → the user receives ₦158,800.
    expect(h.quoteCreate.mock.calls[0][0].data.amountOut).toBe(15_880_000n);
  });

  it("leaves us selling dollars above the price we buy them at", async () => {
    // The whole point of an uneven book, asserted as a round trip rather than
    // as two rates: a dollar must not be worth more leaving than arriving.
    h.quoteFx.mockResolvedValue({
      reference: "a",
      source: { currency: "NGN", amount: 1_000_000 },
      target: { currency: "USD", amount: 625 },
      rate: 0.000625,
    });
    await createConvertQuote({
      userId: "u1", tier: 2, fromAsset: "NGN" as never, toAsset: "USD" as never,
      amountInMinor: 1_000_000n,
    });
    const usdOut = h.quoteCreate.mock.calls[0][0].data.amountOut as bigint;
    const askNgnPerUsd = 1_000_000 / Number(usdOut); // kobo per cent == naira per dollar

    h.quoteCreate.mockClear();
    h.quoteFx.mockResolvedValue({
      reference: "b",
      source: { currency: "USD", amount: 10_000 },
      target: { currency: "NGN", amount: 16_000_000 },
      rate: 1600,
    });
    await createConvertQuote({
      userId: "u1", tier: 2, fromAsset: "USD" as never, toAsset: "NGN" as never,
      amountInMinor: 10_000n,
    });
    const ngnOut = h.quoteCreate.mock.calls[0][0].data.amountOut as bigint;
    const bidNgnPerUsd = Number(ngnOut) / 10_000;

    expect(askNgnPerUsd).toBeGreaterThan(bidNgnPerUsd);
    expect(askNgnPerUsd).toBeCloseTo(1623.38, 1); // we sell dollars here
    expect(bidNgnPerUsd).toBeCloseTo(1588.0, 1); // and buy them here
  });

  it("settles on the same side it quoted", async () => {
    // Quote and settlement must not land on opposite sides of the spread.
    h.quoteFindUnique.mockResolvedValue(fxQuote); // NGN -> USD
    h.txFindUnique.mockResolvedValue(null);
    h.quoteUpdateMany.mockResolvedValue({ count: 1 });
    h.balanceUpdateMany.mockResolvedValue({ count: 1 });
    h.balanceUpsert.mockResolvedValue({});
    h.txCreate.mockResolvedValue({ id: "tx1", status: "COMPLETED" });
    h.auditCreate.mockResolvedValue({});
    h.notifyUser.mockResolvedValue(undefined);
    h.exchangeFx.mockResolvedValue({
      source: { currency: "NGN", amount: 1_000_000 },
      target: { currency: "USD", amount: 625 },
      rate: 0.000625,
    });

    await executeSwap({ userId: "u1", quoteId: "q1", idempotencyKey: "idem-s1" });

    expect(h.getFxSideMarginBps).toHaveBeenCalledWith("sell_usd");
    expect(h.getFxSideMarginBps).not.toHaveBeenCalledWith("buy_usd");
    expect(h.balanceUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { available: { increment: 616n } } }),
    );
  });
});
