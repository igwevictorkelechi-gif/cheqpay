import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  txFindFirst: vi.fn(),
  auditCreate: vi.fn(),
  creditBalance: vi.fn(),
  notifyUser: vi.fn(),
  awardCashback: vi.fn(),
  ensureUsdAsset: vi.fn(),
  getDepositFeeBps: vi.fn(),
  getCustomerTransactions: vi.fn(),
}));

vi.mock("@cheqpay/db", () => ({
  Asset: { NGN: "NGN", USD: "USD", BTC: "BTC", USDT: "USDT", USDC: "USDC" },
  Network: { FIAT: "FIAT", SOLANA: "SOLANA", TRON: "TRON" },
  TransactionType: { DEPOSIT: "DEPOSIT" },
  prisma: {
    transaction: { findFirst: h.txFindFirst },
    auditLog: { create: h.auditCreate },
  },
}));
vi.mock("../ledger", () => ({ creditBalance: h.creditBalance }));
vi.mock("../alerts", () => ({ notifyUser: h.notifyUser }));
vi.mock("../cashback", () => ({ awardCashback: h.awardCashback }));
vi.mock("../ensureUsdAsset", () => ({ ensureUsdAsset: h.ensureUsdAsset }));
vi.mock("../settings", () => ({
  // Real fee maths, mockable rate — keeps the interpretation honest.
  feeFromBps: (amt: bigint, bps: number) =>
    bps <= 0 ? 0n : (amt * BigInt(Math.trunc(bps))) / 10_000n,
  getDepositFeeBps: h.getDepositFeeBps,
}));
vi.mock("./transactions", () => ({
  getCustomerTransactions: h.getCustomerTransactions,
}));

import { previewReconciliation, commitReconciliation } from "./reconcile";
import type { MapleradTransaction } from "./transactions";

function tx(over: Partial<MapleradTransaction>): MapleradTransaction {
  return {
    id: "t1",
    status: "SUCCESS",
    entry: "CREDIT",
    type: "FUNDING",
    amount: "10000",
    currency: "NGN",
    created_at: "2026-01-01T00:00:00Z",
    source: { bank_name: "Kuda Bank", account_number: "1400123000", account_name: "A" },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.txFindFirst.mockResolvedValue(null); // nothing credited yet by default
  h.getDepositFeeBps.mockResolvedValue(0);
  h.creditBalance.mockResolvedValue({ created: true, transactionId: "new-tx" });
  h.auditCreate.mockResolvedValue({});
  h.awardCashback.mockResolvedValue(0n);
  h.notifyUser.mockResolvedValue({ devices: 0, email: false });
  h.ensureUsdAsset.mockResolvedValue(undefined);
});

describe("previewReconciliation classification", () => {
  it("marks a settled NGN funding as creditable with the net shown", async () => {
    h.getCustomerTransactions.mockResolvedValue([tx({ id: "a" })]);
    const res = await previewReconciliation("cust");
    const it = res.items[0];
    expect(it).toMatchObject({
      id: "a",
      asset: "NGN",
      creditable: true,
      alreadyCredited: false,
      amountMinor: "10000",
      feeMinor: "0",
      netMinor: "10000",
      netDisplay: "₦100.00",
    });
    expect(res.summary.creditableMissing).toBe(1);
  });

  it("withholds the platform deposit fee from the net", async () => {
    h.getDepositFeeBps.mockResolvedValue(100); // 1%
    h.getCustomerTransactions.mockResolvedValue([tx({ id: "a", amount: "10000" })]);
    const res = await previewReconciliation("cust");
    expect(res.items[0]).toMatchObject({
      amountMinor: "10000",
      feeMinor: "100",
      netMinor: "9900",
      netDisplay: "₦99.00",
    });
  });

  it("reads a decimal amount as whole units", async () => {
    // "12.50" USD → 1250 cents.
    h.getCustomerTransactions.mockResolvedValue([
      tx({ id: "a", currency: "USD", amount: "12.50" }),
    ]);
    const res = await previewReconciliation("cust");
    expect(res.items[0]).toMatchObject({
      asset: "USD",
      amountMinor: "1250",
      netDisplay: "$12.50",
      creditable: true,
    });
  });

  it("flags a transaction already in our ledger as credited, not creditable", async () => {
    h.txFindFirst.mockImplementation(async ({ where }: any) => {
      return where.idempotencyKey.in.includes("deposit:maplerad:done")
        ? { id: "ledger-done" }
        : null;
    });
    h.getCustomerTransactions.mockResolvedValue([tx({ id: "done" })]);
    const res = await previewReconciliation("cust");
    expect(res.items[0]).toMatchObject({
      alreadyCredited: true,
      creditable: false,
      transactionId: "ledger-done",
    });
    expect(res.summary.alreadyCredited).toBe(1);
  });

  it("also treats the crypto idempotency key as credited for USD (offramp guard)", async () => {
    h.txFindFirst.mockImplementation(async ({ where }: any) => {
      return where.idempotencyKey.in.includes("deposit:maplerad:crypto:u1")
        ? { id: "ledger-crypto" }
        : null;
    });
    h.getCustomerTransactions.mockResolvedValue([
      tx({ id: "u1", currency: "USD", amount: "500" }),
    ]);
    const res = await previewReconciliation("cust");
    expect(res.items[0].alreadyCredited).toBe(true);
  });

  it("refuses a debit, a non-settled status, an unknown currency and a non-deposit type", async () => {
    h.getCustomerTransactions.mockResolvedValue([
      tx({ id: "debit", entry: "DEBIT" }),
      tx({ id: "pending", status: "PENDING" }),
      tx({ id: "ghs", currency: "GHS" }),
      tx({ id: "swap", type: "SWAP" }),
    ]);
    const res = await previewReconciliation("cust");
    const byId = Object.fromEntries(res.items.map((i) => [i.id, i]));
    expect(byId.debit).toMatchObject({ creditable: false, reason: "not an incoming credit" });
    expect(byId.pending).toMatchObject({ creditable: false, reason: "status PENDING" });
    expect(byId.ghs).toMatchObject({ creditable: false, reason: "unsupported currency GHS" });
    expect(byId.swap).toMatchObject({ creditable: false, reason: "not a deposit type (SWAP)" });
    expect(res.summary.creditableMissing).toBe(0);
  });
});

describe("commitReconciliation", () => {
  it("credits only the selected ids, with the shared webhook key", async () => {
    h.getCustomerTransactions.mockResolvedValue([
      tx({ id: "a", amount: "10000" }),
      tx({ id: "b", amount: "20000" }),
    ]);
    const res = await commitReconciliation("user-1", "cust", { ids: ["a"] });

    expect(h.creditBalance).toHaveBeenCalledTimes(1);
    expect(h.creditBalance).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        asset: "NGN",
        amountMinor: 10000n,
        idempotencyKey: "deposit:maplerad:a",
        type: "DEPOSIT",
      }),
    );
    expect(res.summary.credited).toBe(1);
    // The credited row is reflected as done in the returned items.
    expect(res.items.find((i) => i.id === "a")).toMatchObject({ alreadyCredited: true });
  });

  it("credits every creditable-missing row when all:true", async () => {
    h.getCustomerTransactions.mockResolvedValue([
      tx({ id: "a" }),
      tx({ id: "b" }),
      tx({ id: "debit", entry: "DEBIT" }),
    ]);
    const res = await commitReconciliation("user-1", "cust", { all: true });
    expect(h.creditBalance).toHaveBeenCalledTimes(2);
    expect(res.summary.credited).toBe(2);
  });

  it("awards NGN cashback and notifies only on a first credit", async () => {
    h.getCustomerTransactions.mockResolvedValue([tx({ id: "a" })]);
    await commitReconciliation("user-1", "cust", { ids: ["a"] });
    expect(h.awardCashback).toHaveBeenCalledOnce();
    expect(h.notifyUser).toHaveBeenCalledOnce();
  });

  it("does not re-award when the credit was a dedupe (created:false)", async () => {
    h.creditBalance.mockResolvedValue({ created: false, transactionId: "existing" });
    h.getCustomerTransactions.mockResolvedValue([tx({ id: "a" })]);
    const res = await commitReconciliation("user-1", "cust", { ids: ["a"] });
    expect(h.awardCashback).not.toHaveBeenCalled();
    expect(h.notifyUser).not.toHaveBeenCalled();
    // created:false means we did not count it as credited this run.
    expect(res.summary.credited).toBe(0);
  });

  it("never credits a USD deposit already covered by the crypto key", async () => {
    h.txFindFirst.mockImplementation(async ({ where }: any) =>
      where.idempotencyKey.in.includes("deposit:maplerad:crypto:u1")
        ? { id: "ledger-crypto" }
        : null,
    );
    h.getCustomerTransactions.mockResolvedValue([
      tx({ id: "u1", currency: "USD", amount: "500" }),
    ]);
    const res = await commitReconciliation("user-1", "cust", { all: true });
    expect(h.creditBalance).not.toHaveBeenCalled();
    expect(res.summary.credited).toBe(0);
  });
});
