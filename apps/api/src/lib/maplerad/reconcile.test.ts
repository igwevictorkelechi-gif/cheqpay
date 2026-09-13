import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  getCustomerTransactions: vi.fn(),
  verifyTransaction: vi.fn(),
  hasProcessed: vi.fn(),
  findUserByAccount: vi.fn(),
  creditUser: vi.fn(),
  getDepositFeeBps: vi.fn(),
  userFindFirst: vi.fn(),
  cryptoTxFindFirst: vi.fn(),
  walletFindMany: vi.fn(),
}));

vi.mock("@cheqpay/db", () => ({
  Asset: { NGN: "NGN", USD: "USD", BTC: "BTC", USDT: "USDT", USDC: "USDC" },
  Network: {
    FIAT: "FIAT", SOLANA: "SOLANA", ETHEREUM: "ETHEREUM", BASE: "BASE",
    POLYGON: "POLYGON", TRON: "TRON", BSC: "BSC", BITCOIN: "BITCOIN",
  },
  TransactionType: { DEPOSIT: "DEPOSIT" },
  // settle.ts now reaches the crypto-collection path, which reads these.
  prisma: {
    user: { findFirst: h.userFindFirst },
    transaction: { findFirst: h.cryptoTxFindFirst },
    wallet: { findMany: h.walletFindMany },
  },
}));
vi.mock("./transactions", () => ({
  getCustomerTransactions: h.getCustomerTransactions,
  verifyTransaction: h.verifyTransaction,
}));
vi.mock("../mapleradCollections", () => ({
  prismaLedgerPort: {
    hasProcessed: h.hasProcessed,
    findUserByAccount: h.findUserByAccount,
    creditUser: h.creditUser,
  },
}));
vi.mock("../settings", () => ({
  feeFromBps: (amt: bigint, bps: number) =>
    bps <= 0 ? 0n : (amt * BigInt(Math.trunc(bps))) / 10_000n,
  getDepositFeeBps: h.getDepositFeeBps,
}));

import { previewReconciliation, commitReconciliation } from "./reconcile";
import type { VerifiedTransaction } from "./transactions";

function verified(over: Partial<VerifiedTransaction> = {}): VerifiedTransaction {
  return {
    id: "t1",
    status: "SUCCESS",
    entry: "CREDIT",
    type: "COLLECTION",
    amount: 100000000,
    currency: "NGN",
    account_id: "acct-1",
    customer: { id: "cust-1" },
    source: { bank_name: "Opay", account_number: "7014998301", account_name: "V K IGWE" },
    created_at: "2026-09-13T05:54:24Z",
    ...over,
  };
}

/** Wire the customer index + per-id verify from a map of id -> verified tx. */
function withDeposits(txs: VerifiedTransaction[]) {
  h.getCustomerTransactions.mockResolvedValue({
    deposit: txs.map((t) => ({ transaction_id: t.id, amount: 0 })),
    withdrawal: [],
  });
  const byId = new Map(txs.map((t) => [t.id, t]));
  h.verifyTransaction.mockImplementation(async (id: string) => {
    const t = byId.get(id);
    if (!t) throw new Error(`no such tx ${id}`);
    return t;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.hasProcessed.mockResolvedValue(false);
  h.findUserByAccount.mockResolvedValue({ userId: "user-1" });
  h.creditUser.mockResolvedValue(undefined);
  h.getDepositFeeBps.mockResolvedValue(0);
  h.userFindFirst.mockResolvedValue({ id: "user-1" });
  h.cryptoTxFindFirst.mockResolvedValue(null);
  h.walletFindMany.mockResolvedValue([]);
});

describe("previewReconciliation", () => {
  it("verifies each deposit and marks a settled NGN collection creditable with the net shown", async () => {
    withDeposits([verified({ id: "a", amount: 100000000 })]);
    const res = await previewReconciliation("cust");
    expect(res.items[0]).toMatchObject({
      id: "a",
      asset: "NGN",
      creditable: true,
      alreadyCredited: false,
      amountMinor: "100000000",
      feeMinor: "0",
      netMinor: "100000000",
      netDisplay: "₦1000000.00",
    });
    expect(res.summary.creditableMissing).toBe(1);
  });

  it("withholds the platform deposit fee from the net", async () => {
    h.getDepositFeeBps.mockResolvedValue(100); // 1%
    withDeposits([verified({ id: "a", amount: 100000000 })]);
    const res = await previewReconciliation("cust");
    expect(res.items[0]).toMatchObject({
      feeMinor: "1000000",
      netMinor: "99000000",
      netDisplay: "₦990000.00",
    });
  });

  it("flags an already-credited deposit as credited, not creditable", async () => {
    withDeposits([verified({ id: "done" })]);
    h.hasProcessed.mockResolvedValue(true);
    const res = await previewReconciliation("cust");
    expect(res.items[0]).toMatchObject({ alreadyCredited: true, creditable: false });
    expect(res.summary.alreadyCredited).toBe(1);
  });

  it("surfaces a verify failure as an un-creditable row instead of aborting", async () => {
    h.getCustomerTransactions.mockResolvedValue({
      deposit: [{ transaction_id: "bad" }, { transaction_id: "good" }],
      withdrawal: [],
    });
    h.verifyTransaction.mockImplementation(async (id: string) => {
      if (id === "bad") throw new Error("boom");
      return verified({ id: "good" });
    });
    const res = await previewReconciliation("cust");
    const bad = res.items.find((i) => i.id === "bad")!;
    const good = res.items.find((i) => i.id === "good")!;
    expect(bad).toMatchObject({ creditable: false, reason: expect.stringContaining("could not verify") });
    expect(good.creditable).toBe(true);
  });

  it("refuses a debit, a pending status and an unsupported currency", async () => {
    withDeposits([
      verified({ id: "debit", entry: "DEBIT" }),
      verified({ id: "pending", status: "PENDING" }),
      verified({ id: "ghs", currency: "GHS" }),
    ]);
    const res = await previewReconciliation("cust");
    const byId = Object.fromEntries(res.items.map((i) => [i.id, i]));
    expect(byId.debit).toMatchObject({ creditable: false, reason: "not an incoming credit" });
    expect(byId.pending).toMatchObject({ creditable: false, reason: "status PENDING" });
    expect(byId.ghs).toMatchObject({ creditable: false, reason: "unsupported currency GHS" });
    expect(res.summary.creditableMissing).toBe(0);
  });
});

describe("commitReconciliation", () => {
  it("credits only the selected ids via the shared settle path", async () => {
    withDeposits([verified({ id: "a", amount: 100000000 }), verified({ id: "b", amount: 5000000 })]);
    const res = await commitReconciliation("user-1", "cust", { ids: ["a"] });
    expect(h.creditUser).toHaveBeenCalledTimes(1);
    expect(h.creditUser).toHaveBeenCalledWith(
      expect.objectContaining({ amountMinor: 100000000, providerTxId: "a", currency: "NGN" }),
    );
    expect(res.summary.credited).toBe(1);
    expect(res.items.find((i) => i.id === "a")).toMatchObject({ alreadyCredited: true });
  });

  it("credits every creditable-missing row when all:true", async () => {
    withDeposits([
      verified({ id: "a" }),
      verified({ id: "b" }),
      verified({ id: "debit", entry: "DEBIT" }),
    ]);
    const res = await commitReconciliation("user-1", "cust", { all: true });
    expect(h.creditUser).toHaveBeenCalledTimes(2);
    expect(res.summary.credited).toBe(2);
  });

  it("counts a duplicate settle as not-credited but marks the row done", async () => {
    withDeposits([verified({ id: "a" })]);
    h.hasProcessed.mockResolvedValue(true); // settle sees it as already processed
    const res = await commitReconciliation("user-1", "cust", { all: true });
    // hasProcessed true means toItem marks it already-credited, so it isn't even a target.
    expect(h.creditUser).not.toHaveBeenCalled();
    expect(res.summary.credited).toBe(0);
  });
});

describe("a stablecoin collection in the panel", () => {
  /** The live USDT deposit, exactly as production returned it. */
  const usdt = (): VerifiedTransaction =>
    ({
      id: "19cb3252-7665-40e3-8aff-6e29fd8db9aa",
      status: "SUCCESS",
      entry: "CREDIT",
      type: "COLLECTION",
      amount: 1000,
      currency: "USDT",
      channel: "CRYPTO",
      summary: "USDT Deposit | BSC | 0xEB2d…",
      reference: "0x9ef258…",
      account_id: null,
      customer: { id: "678f9b4a-5120-4cfd-bcc4-e73cdd9995ce" },
      source: { bank_name: "BSC", account_number: "0xEB2d…" },
      created_at: "2026-09-13T14:15:37Z",
    }) as VerifiedTransaction;

  it("shows it as creditable at the offramped USD value, not 'unsupported currency'", async () => {
    withDeposits([usdt()]);
    const res = await previewReconciliation("cust");
    expect(res.items[0]).toMatchObject({
      currency: "USDT",
      asset: "USD", // BSC cannot be withdrawn from, so it offramps
      amountMinor: "1000",
      feeMinor: "0", // crypto deposits carry no platform fee
      netDisplay: "$10.00",
      creditable: true,
      alreadyCredited: false,
    });
    expect(res.items[0].reason).toBeUndefined();
    expect(res.summary.creditableMissing).toBe(1);
  });

  it("shows it as already credited once it has been", async () => {
    withDeposits([usdt()]);
    h.cryptoTxFindFirst.mockResolvedValue({ id: "led-1" });
    const res = await previewReconciliation("cust");
    expect(res.items[0]).toMatchObject({ alreadyCredited: true, creditable: false });
  });

  it("explains, rather than crediting, when the owner cannot be placed", async () => {
    withDeposits([usdt()]);
    h.userFindFirst.mockResolvedValue(null);
    const res = await previewReconciliation("cust");
    expect(res.items[0]).toMatchObject({
      creditable: false,
      reason: "no user for this Maplerad customer",
    });
  });
});
