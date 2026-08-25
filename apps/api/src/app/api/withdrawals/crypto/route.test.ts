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
  assertFeatureEnabled: vi.fn(),
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
    transaction: { findUnique: h.txFindUnique, update: vi.fn() },
    auditLog: { create: vi.fn() },
    balance: { update: vi.fn() },
    $transaction: (arg: unknown) =>
      typeof arg === "function"
        ? (arg as (db: unknown) => unknown)({
            balance: { updateMany: h.balanceUpdateMany },
            transaction: { create: h.txCreate },
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
vi.mock("@/lib/settings", () => ({ getUsdtNgnRate: h.getUsdtNgnRate }));
vi.mock("@/lib/rates", () => ({ cryptoToNgnKobo: () => 1_000_000n }));
vi.mock("@/lib/limits", () => ({
  assertWithdrawalAllowed: vi.fn(),
  sumTodayWithdrawalsNgnKobo: vi.fn().mockResolvedValue(0n),
  todayWithdrawalStats: vi.fn().mockResolvedValue({ count: 0, sumKobo: 0n }),
}));
vi.mock("@/lib/aml", () => ({
  amlConfigFromEnv: () => ({}),
  assessWithdrawal: () => ({ blocked: false, holdForReview: false, reasons: [] }),
}));
vi.mock("@/lib/alerts", () => ({ notifyUser: vi.fn() }));
vi.mock("@/lib/adminAlert", () => ({ notifyAdminAlert: vi.fn() }));
vi.mock("@/lib/ratelimit", () => ({ enforceRateLimit: vi.fn() }));
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
    h.txFindUnique.mockResolvedValue(null);
    h.balanceUpdateMany.mockResolvedValue({ count: 1 });
    h.txCreate.mockResolvedValue({ id: "tx1", status: "PROCESSING" });
    h.getUsdtNgnRate.mockResolvedValue(1500);
    h.getSpotUsdt.mockResolvedValue({ toString: () => "1" });
    h.createWithdrawal.mockResolvedValue({ txHash: "0xhash" });
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
