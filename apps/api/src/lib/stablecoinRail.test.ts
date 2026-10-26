import { beforeEach, describe, expect, it, vi } from "vitest";

// Buying or selling USDT for naira is backed at Maplerad: Maplerad keeps
// stablecoins as dollars, so the trade is priced from, and settled by, the
// naira ⇄ dollar exchange it amounts to. Maplerad counts that in cents; we
// count USDT to 6 places, so one Maplerad cent is 10,000 of ours.

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
vi.mock("./kyc", () => ({ isWithinSingleTxLimit: () => true }));
vi.mock("./maplerad/fx", () => ({ quoteFx: h.quoteFx, exchangeFx: h.exchangeFx }));
vi.mock("./maplerad/treasury", () => ({ getProviderBalanceMinor: h.providerBalance }));
vi.mock("./ensureUsdAsset", () => ({ ensureUsdAsset: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./ensureQuoteProviderRef", () => ({ ensureQuoteProviderRef: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./settings", () => ({
  getCryptoSettlement: h.settlement,
  getSwapSpreadBpsFor: h.spreadFor,
  getFxSideMarginBps: vi.fn().mockResolvedValue(0),
  getUsdtNgnRate: h.usdtNgnRate,
  feeFromBps: (amt: bigint, bps: number) => (bps <= 0 ? 0n : (amt * BigInt(Math.trunc(bps))) / 10_000n),
}));
vi.mock("./cashback", () => ({ awardCashback: h.awardCashback }));
vi.mock("./alerts", () => ({ notifyUser: h.notifyUser }));
vi.mock("./opsAlert", () => ({ alertOpsOnce: vi.fn() }));
vi.mock("@/market", () => ({ getPriceFeed: () => ({ getSpotUsdt: vi.fn().mockResolvedValue(new RealDecimal(1)) }) }));

import { MapleradError } from "./maplerad/client";
import { createConvertQuote, createQuote, executeSwap } from "./swap";

const SPREADS = { buy: 200, sell: 200, convert: 100 } as const;

function reset() {
  Object.values(h).forEach((fn) => fn.mockReset());
  h.settlement.mockResolvedValue("maplerad");
  h.spreadFor.mockImplementation((kind: keyof typeof SPREADS) => Promise.resolve(SPREADS[kind]));
  h.providerBalance.mockResolvedValue(null);
  h.usdtNgnRate.mockResolvedValue(1355);
  h.quoteCreate.mockImplementation(({ data }: { data: object }) => Promise.resolve({ id: "q1", ...data }));
}

describe("quoting a USDT buy or sell backed at Maplerad", () => {
  beforeEach(reset);

  it("prices a USDT buy from Maplerad's naira → dollar quote, less the buy spread", async () => {
    // ₦13,730 buys $10.00 at Maplerad.
    h.quoteFx.mockResolvedValue({ reference: "fxref", source: { currency: "NGN", amount: 1_373_000 }, target: { currency: "USD", amount: 1_000 }, rate: 0 });

    const q = await createQuote({ userId: "u1", tier: 2, side: "buy", cryptoAsset: "USDT" as never, amountInMinor: 1_373_000n });

    expect(h.quoteFx).toHaveBeenCalledWith(expect.objectContaining({ sourceCurrency: "NGN", targetCurrency: "USD", amount: 1_373_000 }));
    expect(h.spreadFor).toHaveBeenCalledWith("buy");
    expect(q.amountOut).toBe(9_800_000n); // 10 USDT less 2% = 9.8 USDT
    expect(q.providerRef).toBe("fxref");
    // Read by the apps as naira per coin: ₦13,730 / 9.8 USDT.
    expect(Number(q.rate)).toBeCloseTo(1401.02, 2);
  });

  it("prices a USDT sell from Maplerad's dollar → naira quote, trimming what's finer than a cent", async () => {
    h.quoteFx.mockResolvedValue({ reference: "fxref", source: { currency: "USD", amount: 534 }, target: { currency: "NGN", amount: 731_580 }, rate: 0 });

    const q = await createQuote({ userId: "u1", tier: 2, side: "sell", cryptoAsset: "USDT" as never, amountInMinor: 5_349_706n });

    expect(h.quoteFx).toHaveBeenCalledWith(expect.objectContaining({ sourceCurrency: "USD", targetCurrency: "NGN", amount: 534 }));
    expect(q.amountIn).toBe(5_340_000n); // 5.34 USDT; the 0.009706 stays with the user
    expect(q.amountOut).toBe(716_949n); // ₦7,315.80 less 2%
  });

  it("checks the business dollar wallet in cents before selling", async () => {
    h.providerBalance.mockResolvedValue(500n); // $5.00 held, $5.34 needed
    await expect(
      createQuote({ userId: "u1", tier: 2, side: "sell", cryptoAsset: "USDT" as never, amountInMinor: 5_349_706n }),
    ).rejects.toMatchObject({ code: "liquidity_low" });
    expect(h.providerBalance).toHaveBeenCalledWith("USD");
    expect(h.quoteFx).not.toHaveBeenCalled();
  });

  it("refuses a sell smaller than a cent", async () => {
    await expect(
      createQuote({ userId: "u1", tier: 2, side: "sell", cryptoAsset: "USDT" as never, amountInMinor: 9_999n }),
    ).rejects.toMatchObject({ code: "amount_too_small" });
  });

  it("says which way still works when Maplerad won't exchange naira", async () => {
    h.quoteFx.mockRejectedValue(new MapleradError("NGN exchanges are not enabled for this business", 400, null));
    await expect(
      createQuote({ userId: "u1", tier: 2, side: "buy", cryptoAsset: "USDT" as never, amountInMinor: 1_373_000n }),
    ).rejects.toMatchObject({
      code: "fx_direction_unavailable",
      message: "Buying USDT with naira isn't available right now. You can still sell USDT for naira. Nothing was charged.",
    });
  });

  it("backs a naira ⇄ USDT convert the same way", async () => {
    h.quoteFx.mockResolvedValue({ reference: "fxref", source: { currency: "NGN", amount: 1_373_000 }, target: { currency: "USD", amount: 1_000 }, rate: 0 });
    const q = await createConvertQuote({ userId: "u1", tier: 2, fromAsset: "NGN" as never, toAsset: "USDT" as never, amountInMinor: 1_373_000n });
    expect(q.amountOut).toBe(9_800_000n);
    expect(q.providerRef).toBe("fxref");
  });

  it("stays on CheqPay's own books when settlement is switched to ledger", async () => {
    h.settlement.mockResolvedValue("ledger");
    await createQuote({ userId: "u1", tier: 2, side: "buy", cryptoAsset: "USDT" as never, amountInMinor: 1_373_000n });
    expect(h.quoteFx).not.toHaveBeenCalled();
    expect(h.usdtNgnRate).toHaveBeenCalled();
  });

  it("leaves BTC on CheqPay's books: Maplerad has nothing to back it with", async () => {
    await createQuote({ userId: "u1", tier: 2, side: "buy", cryptoAsset: "BTC" as never, amountInMinor: 1_373_000n });
    expect(h.quoteFx).not.toHaveBeenCalled();
  });
});

describe("settling a USDT buy or sell at Maplerad", () => {
  const buyQuote = {
    id: "q1",
    userId: "u1",
    fromAsset: "NGN",
    toAsset: "USDT",
    amountIn: 1_373_000n,
    amountOut: 9_800_000n,
    rate: { toString: () => "1401.02" },
    providerRef: "fxref",
    consumed: false,
    expiresAt: new Date(Date.now() + 60_000),
  };

  beforeEach(() => {
    reset();
    h.txFindUnique.mockResolvedValue(null);
    h.quoteUpdateMany.mockResolvedValue({ count: 1 });
    h.balanceUpdateMany.mockResolvedValue({ count: 1 });
    h.balanceUpsert.mockResolvedValue({});
    h.balanceUpdate.mockResolvedValue({});
    h.txCreate.mockResolvedValue({ id: "tx1", status: "COMPLETED" });
    h.auditCreate.mockResolvedValue({});
    h.notifyUser.mockResolvedValue(undefined);
  });

  it("exchanges the naira for dollars, then credits the USDT as a BUY with cashback", async () => {
    h.quoteFindUnique.mockResolvedValue(buyQuote);
    h.exchangeFx.mockResolvedValue({ source: { currency: "NGN", amount: 1_373_000 }, target: { currency: "USD", amount: 1_000 }, rate: 0 });

    await executeSwap({ userId: "u1", quoteId: "q1", idempotencyKey: "k1" });

    expect(h.exchangeFx).toHaveBeenCalledWith({ quoteReference: "fxref" });
    expect(h.balanceUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ asset: "NGN", available: { gte: 1_373_000n } }) }));
    expect(h.balanceUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId_asset: { userId: "u1", asset: "USDT" } }, update: { available: { increment: 9_800_000n } } }),
    );
    const tx = h.txCreate.mock.calls[0][0].data;
    expect(tx).toMatchObject({ type: "BUY", asset: "USDT", amount: 9_800_000n });
    expect(tx.metadata).toMatchObject({ kind: "buy", side: "buy", rail: "maplerad_fx", spreadMinor: "200000", spreadAsset: "USDT" });
    expect(h.awardCashback).toHaveBeenCalledWith(expect.objectContaining({ baseNgnMinor: 1_373_000n }));
    expect(h.notifyUser).toHaveBeenCalledWith("u1", expect.objectContaining({ title: "Purchase complete", body: "Bought 9.800000 USDT for ₦13730.00." }));
  });

  it("gives the USDT back and credits nothing when Maplerad's exchange fails", async () => {
    h.quoteFindUnique.mockResolvedValue({ ...buyQuote, fromAsset: "USDT", toAsset: "NGN", amountIn: 5_340_000n, amountOut: 716_949n });
    h.exchangeFx.mockRejectedValue(new Error("insufficient balance"));

    await expect(executeSwap({ userId: "u1", quoteId: "q1", idempotencyKey: "k2" })).rejects.toMatchObject({ code: "fx_failed" });

    expect(h.balanceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId_asset: { userId: "u1", asset: "USDT" } }, data: { available: { increment: 5_340_000n } } }),
    );
    expect(h.txCreate).not.toHaveBeenCalled();
    expect(h.awardCashback).not.toHaveBeenCalled();
  });
});
