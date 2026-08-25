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
vi.mock("./ensureUsdAsset", () => ({ ensureUsdAsset: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./ensureQuoteProviderRef", () => ({ ensureQuoteProviderRef: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./settings", () => ({ getUsdtNgnRate: vi.fn(), getSwapSpreadBps: vi.fn() }));
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
