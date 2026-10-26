import { beforeEach, describe, expect, it, vi } from "vitest";

// Each kind of crypto swap is priced with its own spread: buying crypto with
// naira, selling it for naira, and converting without naira (USD ⇄ USDT).

const { RealDecimal } = vi.hoisted(() => ({
  RealDecimal: (require("@prisma/client") as typeof import("@prisma/client")).Prisma.Decimal,
}));

const SPREADS = { buy: 200, sell: 100, convert: 50 } as const;

const h = vi.hoisted(() => ({
  quoteCreate: vi.fn(),
  spreadFor: vi.fn(),
  spot: vi.fn(),
  findUnique: vi.fn(),
  findMany: vi.fn(),
  deleteMany: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock("@cheqpay/db", () => ({
  Asset: { NGN: "NGN", USD: "USD", BTC: "BTC", USDT: "USDT", USDC: "USDC" },
  Prisma: { Decimal: RealDecimal },
  prisma: {
    quote: { create: h.quoteCreate },
    platformSetting: { findUnique: h.findUnique, findMany: h.findMany, deleteMany: h.deleteMany, upsert: h.upsert },
  },
}));
vi.mock("./kyc", () => ({ isWithinSingleTxLimit: () => true }));
vi.mock("./ensureUsdAsset", () => ({ ensureUsdAsset: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/market", () => ({ getPriceFeed: () => ({ getSpotUsdt: h.spot }) }));

describe("crypto swaps price each kind with its own spread", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.doMock("./settings", () => ({
      getUsdtNgnRate: vi.fn().mockResolvedValue(1355),
      // These price on CheqPay's own books; the Maplerad-backed path is in stablecoinRail.test.ts.
      getCryptoSettlement: vi.fn().mockResolvedValue("ledger"),
      getSwapSpreadBpsFor: h.spreadFor,
      getFxSideMarginBps: vi.fn(),
      feeFromBps: vi.fn(),
    }));
    h.spreadFor.mockImplementation((kind: keyof typeof SPREADS) => Promise.resolve(SPREADS[kind]));
    h.spot.mockResolvedValue(new RealDecimal(1));
    h.quoteCreate.mockImplementation(({ data }: { data: object }) => Promise.resolve({ id: "q", ...data }));
  });

  it("sells USDT for naira at the sell spread: ₦1,341.45 per 1 USDT", async () => {
    const { createQuote } = await import("./swap");
    const q = await createQuote({ userId: "u", tier: 2, side: "sell", cryptoAsset: "USDT" as never, amountInMinor: 1_000_000n });
    expect(h.spreadFor).toHaveBeenCalledWith("sell");
    expect(q.amountOut).toBe(134_145n); // kobo
  });

  it("buys USDT with naira at the buy spread: ₦1,382.10 per 1 USDT", async () => {
    const { createQuote } = await import("./swap");
    const q = await createQuote({ userId: "u", tier: 2, side: "buy", cryptoAsset: "USDT" as never, amountInMinor: 138_210n });
    expect(h.spreadFor).toHaveBeenCalledWith("buy");
    expect(q.amountOut).toBe(1_000_000n); // 1 USDT, 6 decimals
  });

  it("converts USD to USDT at the convert spread", async () => {
    const { createConvertQuote } = await import("./swap");
    const q = await createConvertQuote({ userId: "u", tier: 2, fromAsset: "USD" as never, toAsset: "USDT" as never, amountInMinor: 10_000n });
    expect(h.spreadFor).toHaveBeenCalledWith("convert");
    expect(q.feeBps).toBe(50);
    expect(q.amountOut).toBe(99_500_000n); // $100 less 0.5%
  });

  it("prices a convert that ends in naira as the sell it is", async () => {
    const { createConvertQuote } = await import("./swap");
    const q = await createConvertQuote({ userId: "u", tier: 2, fromAsset: "USDT" as never, toAsset: "NGN" as never, amountInMinor: 1_000_000n });
    expect(h.spreadFor).toHaveBeenCalledWith("sell");
    expect(q.amountOut).toBe(134_145n);
  });
});

describe("swap spread settings", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("./settings");
    Object.values(h).forEach((fn) => fn.mockReset());
  });

  function stored(rows: Record<string, string>) {
    h.findUnique.mockImplementation(({ where: { key } }: { where: { key: string } }) =>
      Promise.resolve(key in rows ? { key, value: rows[key] } : null),
    );
    h.findMany.mockImplementation(({ where: { key } }: { where: { key: { in: string[] } } }) =>
      Promise.resolve(key.in.filter((k) => k in rows).map((k) => ({ key: k, value: rows[k] }))),
    );
  }

  it("uses a kind's own spread, else the shared one", async () => {
    const { getSwapSpreadBpsFor, getSwapSpreads } = await import("./settings");
    stored({ swap_spread_bps: "200", swap_spread_sell_bps: "100" });
    await expect(getSwapSpreadBpsFor("sell")).resolves.toBe(100);
    await expect(getSwapSpreadBpsFor("buy")).resolves.toBe(200);
    await expect(getSwapSpreads()).resolves.toEqual({ defaultBps: 200, buyBps: null, sellBps: 100, convertBps: null });
  });

  it("clears a kind back to the shared spread with null", async () => {
    const { setSwapSpreadBpsFor } = await import("./settings");
    await setSwapSpreadBpsFor("convert", null);
    expect(h.deleteMany).toHaveBeenCalledWith({ where: { key: "convert_spread_bps" } });
    await setSwapSpreadBpsFor("convert", 50, "admin@cheqpay.com");
    expect(h.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { key: "convert_spread_bps" } }));
  });
});
