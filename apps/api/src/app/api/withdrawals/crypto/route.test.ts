import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  requireUser: vi.fn(),
  requireMfa: vi.fn(),
  userFindUnique: vi.fn(),
  balanceUpdateMany: vi.fn(),
  txCreate: vi.fn(),
  txFindUnique: vi.fn(),
  isManualAsset: vi.fn(),
  createWithdrawal: vi.fn(),
  getSpotUsdt: vi.fn(),
  getUsdtNgnRate: vi.fn(),
  getWithdrawalMinUsd: vi.fn(),
  usdCents: vi.fn(),
  assertFeatureEnabled: vi.fn(),
  feeInCoin: vi.fn(),
}));

vi.mock("@cheqpay/db", () => ({
  Asset: { NGN: "NGN", USD: "USD", BTC: "BTC", USDT: "USDT", USDC: "USDC" },
  Network: {
    FIAT: "FIAT",
    BITCOIN: "BITCOIN",
    TRON: "TRON",
    BSC: "BSC",
    ETHEREUM: "ETHEREUM",
    SOLANA: "SOLANA",
    BASE: "BASE",
    POLYGON: "POLYGON",
  },
  Prisma: { Decimal: class D { constructor(private v: unknown) {} toString() { return String(this.v); } } },
  TransactionStatus: { PENDING: "PENDING", PROCESSING: "PROCESSING", FAILED: "FAILED" },
  TransactionType: { WITHDRAWAL: "WITHDRAWAL" },
  prisma: {
    user: { findUnique: h.userFindUnique },
    transaction: { findUnique: h.txFindUnique, update: vi.fn().mockResolvedValue({}) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    balance: { update: vi.fn() },
    $transaction: (arg: unknown) =>
      typeof arg === "function"
        ? (arg as (db: unknown) => unknown)({
            balance: { updateMany: h.balanceUpdateMany },
            transaction: { create: h.txCreate },
            $queryRaw: vi.fn().mockResolvedValue([]),
          })
        : Promise.resolve([]),
  },
}));
vi.mock("@/lib/auth", () => ({ requireUser: h.requireUser, requireMfa: h.requireMfa }));
vi.mock("@/lib/features", () => ({ assertFeatureEnabled: h.assertFeatureEnabled }));
vi.mock("@/lib/manualCrypto", () => ({ isManualAsset: h.isManualAsset }));
vi.mock("@/custody", () => ({
  getCustodyProvider: () => ({ createWithdrawal: h.createWithdrawal }),
}));
vi.mock("@/market", () => ({ getPriceFeed: () => ({ getSpotUsdt: h.getSpotUsdt }) }));
vi.mock("@/lib/settings", () => ({
  getUsdtNgnRate: h.getUsdtNgnRate,
  getWithdrawalMinUsd: h.getWithdrawalMinUsd,
  getPricing: async () => ({ cryptoWithdrawalFeeUsd: 2.5 }),
}));
// The coin conversion is tested in lib/fees.test.ts; here the fee is a fixed
// number of minor units so the split is easy to read.
vi.mock("@/lib/fees", async () => {
  const real = await vi.importActual<typeof import("@/lib/fees")>("@/lib/fees");
  return { ...real, usdFeeInCoin: () => h.feeInCoin() };
});
vi.mock("@/lib/rates", () => ({
  cryptoToNgnKobo: () => 1_000_000n,
  cryptoToUsdCents: () => h.usdCents(),
}));
vi.mock("@/lib/limits", () => ({
  assertWithdrawalAllowed: vi.fn(),
  sumTodayWithdrawalsNgnKobo: vi.fn().mockResolvedValue(0n),
  lockUserMoney: vi.fn().mockResolvedValue(undefined),
  todayWithdrawalStats: vi.fn().mockResolvedValue({ count: 0, sumKobo: 0n }),
}));
vi.mock("@/lib/aml", () => ({
  amlConfigFromEnv: () => ({}),
  assessWithdrawal: () => ({ blocked: false, holdForReview: false, reasons: [] }),
}));
vi.mock("@/lib/alerts", () => ({ notifyUser: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/adminAlert", () => ({ notifyAdminAlert: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/ratelimit", () => ({ enforceRateLimit: vi.fn() }));
// The PIN gate has its own tests (lib/transactionPin.test.ts) and its presence
// on every money route is asserted statically in moneyRoutesPinned.test.ts.
// Here it is stubbed so these cases stay about the withdrawal rules.
vi.mock("@/lib/transactionPin", () => ({
  readPin: () => "8305",
  requireTransactionPin: vi.fn(),
}));
vi.mock("@/lib/env", () => ({ getEnv: () => ({ RELAX_WITHDRAWAL_GUARDS: true }) }));

import { POST } from "./route";

function call(body: unknown) {
  return POST(
    new Request("https://api/x", {
      method: "POST",
      headers: { "idempotency-key": `k-${Math.random()}` },
      body: JSON.stringify(body),
    }),
  );
}

const base = {
  asset: "USDT",
  toAddress: "0x0000000000000000000000000000000000000001",
  amount: "10",
};

/**
 * Maplerad mints stablecoin addresses on six chains but POST /crypto/transfer
 * accepts exactly one: solana. The other five are receive-only.
 *
 * Before this gate the route accepted them, debited the user, called custody,
 * got a refusal, and refunded — a round trip through the ledger for a request
 * that could never have succeeded, ending in an error the user could do nothing
 * with. Refusing before the debit is the whole point.
 */
describe("POST /api/withdrawals/crypto — receive-only chains are refused up front", () => {
  beforeEach(() => {
    Object.values(h).forEach((fn) => fn.mockReset());
    h.requireUser.mockResolvedValue({ id: "u1" });
    h.userFindUnique.mockResolvedValue({ id: "u1", kycTier: 3, instantWithdrawal: true });
    h.assertFeatureEnabled.mockResolvedValue(undefined);
    h.isManualAsset.mockResolvedValue(false);
    h.getWithdrawalMinUsd.mockResolvedValue(0); // no floor unless a test sets one
    h.usdCents.mockReturnValue(1_000n);
    h.txFindUnique.mockResolvedValue(null);
    h.balanceUpdateMany.mockResolvedValue({ count: 1 });
    h.txCreate.mockResolvedValue({ id: "tx1", status: "PROCESSING" });
    h.getUsdtNgnRate.mockResolvedValue(1500);
    h.getSpotUsdt.mockResolvedValue({ toString: () => "1" });
    h.createWithdrawal.mockResolvedValue({ txHash: "0xhash" });
    h.feeInCoin.mockReturnValue(0n);
  });

  it("refuses each receive-only chain without debiting anything", async () => {
    for (const network of ["BASE", "POLYGON", "ETHEREUM", "TRON", "BSC"]) {
      const res = await call({ ...base, network });
      expect(res.status, `${network} should be refused`).toBe(422);
      expect((await res.json()).code).toBe("chain_not_withdrawable");
    }
    expect(h.balanceUpdateMany).not.toHaveBeenCalled();
    expect(h.createWithdrawal).not.toHaveBeenCalled();
  });

  it("still allows Solana, the chain the provider does send from", async () => {
    const res = await call({ ...base, network: "SOLANA", toAddress: "BvH5kAbCdEfGhIjKlMnOpQrStUvWxYz1234567890" });
    expect(res.status).toBe(200);
    expect(h.createWithdrawal).toHaveBeenCalled();
  });

  it("does not apply the provider's chain rule to a manually paid-out asset", async () => {
    // A manual payout leaves the business's own wallet; Maplerad's transfer
    // endpoint is never involved, so its chain list has no say.
    h.isManualAsset.mockResolvedValue(true);
    const res = await call({ ...base, network: "TRON" });
    expect(res.status).toBe(200);
    expect(h.createWithdrawal).not.toHaveBeenCalled();
  });
});

describe("POST /api/withdrawals/crypto — the dollar floor", () => {
  beforeEach(() => {
    Object.values(h).forEach((fn) => fn.mockReset());
    h.requireUser.mockResolvedValue({ id: "u1" });
    h.userFindUnique.mockResolvedValue({ id: "u1", kycTier: 3, instantWithdrawal: true });
    h.assertFeatureEnabled.mockResolvedValue(undefined);
    h.isManualAsset.mockResolvedValue(false);
    h.txFindUnique.mockResolvedValue(null);
    h.balanceUpdateMany.mockResolvedValue({ count: 1 });
    h.txCreate.mockResolvedValue({ id: "tx1", status: "PROCESSING" });
    h.getUsdtNgnRate.mockResolvedValue(1600);
    h.getSpotUsdt.mockResolvedValue({ mul: () => ({}) });
    h.createWithdrawal.mockResolvedValue({ txHash: "0xabc" });
    h.getWithdrawalMinUsd.mockResolvedValue(5);
    h.feeInCoin.mockReturnValue(0n);
  });

  it("refuses a withdrawal worth less than the floor, before any money is reserved", async () => {
    h.usdCents.mockReturnValue(499n); // $4.99
    const res = await call({ ...base, network: "SOLANA", toAddress: "B".repeat(32) });
    expect(res.status).toBe(422);
    expect(h.balanceUpdateMany).not.toHaveBeenCalled();
    expect(h.createWithdrawal).not.toHaveBeenCalled();
  });

  it("allows one worth exactly the floor", async () => {
    h.usdCents.mockReturnValue(500n); // $5.00 — the floor is a minimum, not a threshold
    const res = await call({ ...base, network: "SOLANA", toAddress: "B".repeat(32) });
    expect(res.status).toBe(200);
  });

  it("lets everything through when no floor is set", async () => {
    h.getWithdrawalMinUsd.mockResolvedValue(0);
    h.usdCents.mockReturnValue(1n); // one cent
    const res = await call({ ...base, network: "SOLANA", toAddress: "B".repeat(32) });
    expect(res.status).toBe(200);
  });
});

describe("POST /api/withdrawals/crypto — network fee", () => {
  const sol = { ...base, network: "SOLANA", toAddress: "BvH5kAbCdEfGhIjKlMnOpQrStUvWxYz1234567890" };

  beforeEach(() => {
    Object.values(h).forEach((fn) => fn.mockReset());
    h.requireUser.mockResolvedValue({ id: "u1" });
    h.userFindUnique.mockResolvedValue({ id: "u1", kycTier: 3, instantWithdrawal: true });
    h.isManualAsset.mockResolvedValue(false);
    h.getWithdrawalMinUsd.mockResolvedValue(0);
    h.txFindUnique.mockResolvedValue(null);
    h.balanceUpdateMany.mockResolvedValue({ count: 1 });
    h.txCreate.mockResolvedValue({ id: "tx1", status: "PROCESSING" });
    h.getUsdtNgnRate.mockResolvedValue(1500);
    h.getSpotUsdt.mockResolvedValue({ toString: () => "1" });
    h.createWithdrawal.mockResolvedValue({ txHash: "0xhash" });
    h.feeInCoin.mockReturnValue(2_500_000n); // $2.50 of USDT (6dp)
  });

  it("takes the fee out of the amount when feeInclusive (what the apps send)", async () => {
    const res = await call({ ...sol, amount: "10", feeInclusive: true });
    expect(res.status).toBe(200);
    // Balance drops by exactly 10 USDT; the recipient is sent 7.5.
    expect(h.balanceUpdateMany.mock.calls[0][0].data.available.decrement).toBe(10_000_000n);
    expect(h.createWithdrawal.mock.calls[0][0].amount).toBe("7.500000");
    expect(h.txCreate.mock.calls[0][0].data).toMatchObject({ amount: 7_500_000n, fee: 2_500_000n });
    expect(await res.json()).toMatchObject({ amount: "10.000000", fee: "2.500000", youReceive: "7.500000" });
  });

  it("refuses an amount the fee would swallow, before touching the balance", async () => {
    const res = await call({ ...sol, amount: "2", feeInclusive: true });
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe("below_fee");
    expect(h.balanceUpdateMany).not.toHaveBeenCalled();
  });

  it("adds the fee on top for older clients", async () => {
    await call({ ...sol, amount: "10" });
    expect(h.balanceUpdateMany.mock.calls[0][0].data.available.decrement).toBe(12_500_000n);
    expect(h.createWithdrawal.mock.calls[0][0].amount).toBe("10.000000");
  });
});
