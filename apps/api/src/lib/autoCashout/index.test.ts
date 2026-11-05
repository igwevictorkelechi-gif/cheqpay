import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../http";

/**
 * Auto cash-out engine: a deposit is sold, then paid to the user's own bank,
 * each step at most once, and any failure leaves the money in the wallet.
 * Database, swap, payout and notifications are mocked; SQL is routed by text.
 */

const h = vi.hoisted(() => ({
  claims: [] as unknown[][],
  settings: [] as unknown[],
  executes: [] as { sql: string; values: unknown[] }[],
  txFindUnique: vi.fn(),
  txFindFirst: vi.fn(),
  balanceFindUnique: vi.fn(),
  userFindUnique: vi.fn(),
  beneficiaryFindFirst: vi.fn(),
  createQuote: vi.fn(),
  createConvertQuote: vi.fn(),
  executeSwap: vi.fn(),
  initiateNgnPayout: vi.fn(),
  notifyUser: vi.fn(),
  notifyAdmins: vi.fn(),
  flags: { auto_cashout: true, crypto_trading: true, ngn_withdrawals: true } as Record<string, boolean>,
  usedToday: 0n,
}));

const sqlOf = (strings: TemplateStringsArray) => strings.join("?");

vi.mock("@cheqpay/db", () => ({
  Asset: { NGN: "NGN", USD: "USD", USDT: "USDT", USDC: "USDC", BTC: "BTC" },
  TransactionStatus: { PROCESSING: "PROCESSING", COMPLETED: "COMPLETED" },
  TransactionType: { DEPOSIT: "DEPOSIT", WITHDRAWAL: "WITHDRAWAL" },
  Prisma: {},
  prisma: {
    $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
      const sql = sqlOf(strings);
      if (sql.includes("UPDATE auto_cashouts c SET locked_until")) return h.claims.shift() ?? [];
      if (sql.includes("FROM auto_cashout_settings")) return h.settings;
      if (sql.includes("INSERT INTO auto_cashouts")) return [{ id: "ac1" }];
      return [];
    }),
    $executeRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      h.executes.push({ sql: sqlOf(strings), values });
      return 1;
    }),
    transaction: { findUnique: h.txFindUnique, findFirst: h.txFindFirst },
    balance: { findUnique: h.balanceFindUnique },
    user: { findUnique: h.userFindUnique },
    beneficiary: { findFirst: h.beneficiaryFindFirst },
  },
}));
vi.mock("next/server", () => ({ after: () => { throw new Error("no request scope"); } }));
vi.mock("./schema", () => ({ ensureAutoCashoutSchema: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/features", () => ({ getFeatureFlags: async () => ({ ...h.flags }) }));
vi.mock("@/lib/settings", () => ({ getWithdrawalMinNgn: async () => 2000, getWithdrawalFeeNgn: async () => 200 }));
vi.mock("@/lib/limits", async () => {
  const real = await vi.importActual<typeof import("../limits")>("../limits");
  return { assertWithdrawalAllowed: real.assertWithdrawalAllowed, sumTodayWithdrawalsNgnKobo: async () => h.usedToday };
});
vi.mock("@/lib/env", () => ({ getEnv: () => ({}) }));
vi.mock("@/lib/swap", () => ({
  createQuote: h.createQuote,
  createConvertQuote: h.createConvertQuote,
  executeSwap: h.executeSwap,
}));
vi.mock("@/lib/ngnPayout", () => ({ initiateNgnPayout: h.initiateNgnPayout }));
vi.mock("@/lib/alerts", () => ({ notifyUser: h.notifyUser }));
vi.mock("@/lib/adminNotify", () => ({ notifyAdmins: h.notifyAdmins }));

import { afterDepositCredited, runAutoCashouts } from "./index";

const D = (n: number | bigint) => ({ toFixed: () => String(n) });

function row(over: Record<string, unknown> = {}) {
  return {
    id: "ac1",
    user_id: "u1",
    deposit_tx_id: "dep1",
    asset: "USDT",
    coin: "USDT",
    amount_minor: D(50_000_000n), // 50 USDT
    beneficiary_id: "b1",
    status: "queued",
    swap_tx_id: null,
    ngn_minor: null,
    attempts: 0,
    ...over,
  };
}

const statusUpdates = () =>
  h.executes.filter((e) => e.sql.includes("UPDATE auto_cashouts SET status")).map((e) => e.sql + " " + JSON.stringify(e.values));

beforeEach(() => {
  vi.clearAllMocks();
  h.claims = [];
  h.executes = [];
  h.settings = [{ enabled: true, assets: ["USDT", "BTC"], beneficiary_id: "b1" }];
  h.flags = { auto_cashout: true, crypto_trading: true, ngn_withdrawals: true };
  h.usedToday = 0n;
  h.txFindFirst.mockResolvedValue(null);
  h.txFindUnique.mockImplementation(async ({ where }: { where: { id?: string; idempotencyKey?: string } }) => {
    if (where.idempotencyKey) return null; // no earlier sale
    if (where.id === "swap1") return { id: "swap1", metadata: { amountOut: "6700000" } }; // ₦67,000
    if (where.id === "dep1")
      return { id: "dep1", userId: "u1", type: "DEPOSIT", status: "COMPLETED", asset: "USDT", amount: 50_000_000n, fee: 0n, metadata: {} };
    return null;
  });
  h.balanceFindUnique.mockResolvedValue({ available: 50_000_000n });
  h.userFindUnique.mockResolvedValue({ id: "u1", kycTier: 2, legalName: "Ada Obi" });
  h.beneficiaryFindFirst.mockResolvedValue({ id: "b1", bankCode: "058", bankName: "GTBank", accountNumber: "0123456789" });
  h.createQuote.mockResolvedValue({ id: "q1", amountOut: 6_700_000n });
  h.executeSwap.mockResolvedValue({ transactionId: "swap1", status: "COMPLETED" });
  h.initiateNgnPayout.mockResolvedValue({ transactionId: "wd1", amountMinor: 6_680_000n, unclear: false });
  h.notifyUser.mockResolvedValue({});
  h.notifyAdmins.mockResolvedValue(undefined);
});

describe("auto cash-out", () => {
  it("sells the deposit and pays the naira to the user's own account, once", async () => {
    h.claims.push([row()]);
    const s = await runAutoCashouts({ id: "ac1" });
    expect(s).toMatchObject({ processed: 1, paid: 1 });
    expect(h.createQuote).toHaveBeenCalledWith(expect.objectContaining({ side: "sell", cryptoAsset: "USDT", amountInMinor: 50_000_000n }));
    expect(h.executeSwap).toHaveBeenCalledWith(expect.objectContaining({ quoteId: "q1", idempotencyKey: "autocash:swap:ac1" }));
    expect(h.initiateNgnPayout).toHaveBeenCalledWith(
      expect.objectContaining({
        bankCode: "058",
        accountNumber: "0123456789",
        requestedMinor: 6_700_000n,
        feeInclusive: true,
        extraMetadata: { autoCashoutId: "ac1" },
      }),
    );
    expect(statusUpdates().some((u) => u.includes("'sold'"))).toBe(true);
    expect(statusUpdates().some((u) => u.includes("'paid'"))).toBe(true);
    expect(h.notifyUser).toHaveBeenCalledWith("u1", expect.objectContaining({ title: "Auto cash-out on its way" }));
  });

  it("sells an off-ramped stablecoin (held as dollars) with a USD→NGN conversion", async () => {
    h.claims.push([row({ asset: "USD", amount_minor: D(5000n) })]);
    h.balanceFindUnique.mockResolvedValue({ available: 5000n });
    h.createConvertQuote.mockResolvedValue({ id: "q2", amountOut: 6_700_000n });
    await runAutoCashouts({ id: "ac1" });
    expect(h.createConvertQuote).toHaveBeenCalledWith(expect.objectContaining({ fromAsset: "USD", toAsset: "NGN", amountInMinor: 5000n }));
    expect(h.createQuote).not.toHaveBeenCalled();
  });

  it("leaves a deposit too small to pay out as crypto — nothing is sold", async () => {
    h.claims.push([row()]);
    h.createQuote.mockResolvedValue({ id: "q1", amountOut: 150_000n }); // ₦1,500 < ₦2,000 minimum
    const s = await runAutoCashouts({ id: "ac1" });
    expect(s.stopped).toBe(1);
    expect(h.executeSwap).not.toHaveBeenCalled();
    expect(h.initiateNgnPayout).not.toHaveBeenCalled();
    expect(statusUpdates().some((u) => u.includes("skipped") && u.includes("minimum payout"))).toBe(true);
  });

  it("does not sell when the payout would break the daily limit", async () => {
    h.claims.push([row()]);
    h.usedToday = 10n ** 15n;
    await runAutoCashouts({ id: "ac1" });
    expect(h.executeSwap).not.toHaveBeenCalled();
    expect(statusUpdates().some((u) => u.includes("skipped"))).toBe(true);
  });

  it("does not sell when the user turned it off after the deposit", async () => {
    h.claims.push([row()]);
    h.settings = [{ enabled: false, assets: ["USDT"], beneficiary_id: "b1" }];
    await runAutoCashouts({ id: "ac1" });
    expect(h.createQuote).not.toHaveBeenCalled();
    expect(statusUpdates().some((u) => u.includes("skipped"))).toBe(true);
  });

  it("does not sell coins that already left the wallet", async () => {
    h.claims.push([row()]);
    h.balanceFindUnique.mockResolvedValue({ available: 1n });
    await runAutoCashouts({ id: "ac1" });
    expect(h.createQuote).not.toHaveBeenCalled();
  });

  it("retries a refused payout later, then keeps the naira in the wallet", async () => {
    h.initiateNgnPayout.mockRejectedValue(new ApiError(502, "Payout could not be initiated; funds refunded", "payout_failed"));
    h.claims.push([row()]);
    await runAutoCashouts({ id: "ac1" });
    const retry = h.executes.find((e) => e.sql.includes("next_attempt_at = now()"));
    expect(retry).toBeTruthy();
    expect(statusUpdates().some((u) => u.includes("kept_ngn"))).toBe(false);

    // Last attempt: give up, naira stays, user told.
    h.executes = [];
    h.claims.push([row({ status: "sold", swap_tx_id: "swap1", ngn_minor: D(6_700_000n), attempts: 4 })]);
    await runAutoCashouts({ id: "ac1" });
    expect(h.executeSwap).toHaveBeenCalledTimes(1); // never sold twice
    expect(statusUpdates().some((u) => u.includes("kept_ngn"))).toBe(true);
    expect(h.notifyUser).toHaveBeenCalledWith("u1", expect.objectContaining({ title: "Auto cash-out: naira kept in your wallet" }));
  });

  it("never pays out twice when an earlier payout is already in flight", async () => {
    h.claims.push([row({ status: "sold", swap_tx_id: "swap1", ngn_minor: D(6_700_000n), attempts: 1 })]);
    h.txFindFirst.mockResolvedValue({ id: "wdOld", amount: 6_680_000n });
    const s = await runAutoCashouts({ id: "ac1" });
    expect(s.paid).toBe(1);
    expect(h.initiateNgnPayout).not.toHaveBeenCalled();
  });

  it("reuses a sale that happened but wasn't recorded, instead of selling again", async () => {
    h.claims.push([row({ attempts: 1 })]);
    h.txFindUnique.mockImplementation(async ({ where }: { where: { idempotencyKey?: string } }) =>
      where.idempotencyKey === "autocash:swap:ac1" ? { id: "swap1", metadata: { amountOut: "6700000" } } : null,
    );
    await runAutoCashouts({ id: "ac1" });
    expect(h.createQuote).not.toHaveBeenCalled();
    expect(h.executeSwap).not.toHaveBeenCalled();
    expect(h.initiateNgnPayout).toHaveBeenCalledWith(expect.objectContaining({ requestedMinor: 6_700_000n }));
  });

  it("stops for a person when money may have moved without a record", async () => {
    h.claims.push([row()]);
    h.executeSwap.mockRejectedValue(new ApiError(500, "credit failed", "fx_credit_failed"));
    await runAutoCashouts({ id: "ac1" });
    expect(statusUpdates().some((u) => u.includes("failed"))).toBe(true);
    expect(h.executes.some((e) => e.sql.includes("next_attempt_at = now()"))).toBe(false);
    expect(h.notifyAdmins).toHaveBeenCalled();
  });
});

describe("afterDepositCredited", () => {
  it("queues and runs a deposit of a ticked coin", async () => {
    h.claims.push([row()]);
    await afterDepositCredited("dep1");
    expect(h.initiateNgnPayout).toHaveBeenCalledTimes(1);
  });

  it("does nothing while the feature is off", async () => {
    h.flags.auto_cashout = false;
    await afterDepositCredited("dep1");
    expect(h.txFindUnique).not.toHaveBeenCalled();
    expect(h.createQuote).not.toHaveBeenCalled();
  });

  it("ignores a coin the user didn't tick", async () => {
    h.settings = [{ enabled: true, assets: ["BTC"], beneficiary_id: "b1" }];
    await afterDepositCredited("dep1");
    expect(h.createQuote).not.toHaveBeenCalled();
  });

  it("never throws into the deposit webhook", async () => {
    h.txFindUnique.mockRejectedValue(new Error("db down"));
    await expect(afterDepositCredited("dep1")).resolves.toBeUndefined();
  });
});
