import { beforeEach, describe, expect, it, vi } from "vitest";

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
  Prisma: { Decimal: class D { constructor(public v: unknown) {} toString() { return String(this.v); } } },
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

  it("short-circuits on a replayed idempotency key without re-exchanging", async () => {
    h.txFindUnique.mockResolvedValue({ id: "tx-old", status: "COMPLETED" });
    const r = await executeSwap({ userId: "u1", quoteId: "q1", idempotencyKey: "idem-1" });
    expect(r).toEqual({ transactionId: "tx-old", status: "COMPLETED" });
    expect(h.exchangeFx).not.toHaveBeenCalled();
  });
});
