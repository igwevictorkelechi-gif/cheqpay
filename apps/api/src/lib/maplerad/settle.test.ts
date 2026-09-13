import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  verifyTransaction: vi.fn(),
  hasProcessed: vi.fn(),
  findUserByAccount: vi.fn(),
  creditUser: vi.fn(),
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
    user: { findFirst: vi.fn() },
    transaction: { findFirst: vi.fn() },
    wallet: { findMany: vi.fn() },
  },
}));
vi.mock("./transactions", () => ({ verifyTransaction: h.verifyTransaction }));
vi.mock("../mapleradCollections", () => ({
  prismaLedgerPort: {
    hasProcessed: h.hasProcessed,
    findUserByAccount: h.findUserByAccount,
    creditUser: h.creditUser,
  },
}));

import { classifyVerified, settleCollectionById } from "./settle";
import type { VerifiedTransaction } from "./transactions";

function tx(over: Partial<VerifiedTransaction> = {}): VerifiedTransaction {
  return {
    id: "t1",
    status: "SUCCESS",
    entry: "CREDIT",
    type: "COLLECTION",
    amount: 100000000,
    currency: "NGN",
    account_id: "acct-1",
    customer: { id: "cust-1" },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.hasProcessed.mockResolvedValue(false);
  h.findUserByAccount.mockResolvedValue({ userId: "user-1" });
  h.creditUser.mockResolvedValue(undefined);
});

describe("classifyVerified", () => {
  it("accepts a settled NGN collection credit", () => {
    expect(classifyVerified(tx())).toMatchObject({ creditable: true, asset: "NGN" });
  });
  it("refuses a debit, a non-settled status, unknown currency, non-deposit type, bad amount", () => {
    expect(classifyVerified(tx({ entry: "DEBIT" }))).toMatchObject({
      creditable: false,
      reason: "not an incoming credit",
    });
    expect(classifyVerified(tx({ status: "PENDING" }))).toMatchObject({
      reason: "status PENDING",
    });
    expect(classifyVerified(tx({ currency: "GHS" }))).toMatchObject({
      reason: "unsupported currency GHS",
    });
    expect(classifyVerified(tx({ type: "SWAP" }))).toMatchObject({
      reason: "not a deposit type (SWAP)",
    });
    expect(classifyVerified(tx({ amount: 0 }))).toMatchObject({
      reason: "unreadable amount 0",
    });
  });
});

describe("settleCollectionById", () => {
  it("verifies, matches the owner, and credits with the verified amount", async () => {
    h.verifyTransaction.mockResolvedValue(tx({ id: "abc", amount: 5000000 }));
    const res = await settleCollectionById("abc");
    expect(h.findUserByAccount).toHaveBeenCalledWith({
      accountId: "acct-1",
      customerId: "cust-1",
      currency: "NGN",
    });
    expect(h.creditUser).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        amountMinor: 5000000,
        currency: "NGN",
        providerTxId: "abc",
      }),
    );
    expect(res).toMatchObject({ outcome: "credited", userId: "user-1", amount: 5000000 });
  });

  it("returns duplicate without crediting when already processed", async () => {
    h.verifyTransaction.mockResolvedValue(tx({ id: "abc" }));
    h.hasProcessed.mockResolvedValue(true);
    const res = await settleCollectionById("abc");
    expect(h.creditUser).not.toHaveBeenCalled();
    expect(res.outcome).toBe("duplicate");
  });

  it("returns unmatched (no credit) when no account owns it", async () => {
    h.verifyTransaction.mockResolvedValue(tx({ id: "abc" }));
    h.findUserByAccount.mockResolvedValue(null);
    const res = await settleCollectionById("abc");
    expect(h.creditUser).not.toHaveBeenCalled();
    expect(res.outcome).toBe("unmatched");
  });

  it("ignores a non-creditable transaction before touching the ledger", async () => {
    h.verifyTransaction.mockResolvedValue(tx({ id: "abc", entry: "DEBIT" }));
    const res = await settleCollectionById("abc");
    expect(h.hasProcessed).not.toHaveBeenCalled();
    expect(h.creditUser).not.toHaveBeenCalled();
    expect(res.outcome).toBe("ignored");
  });

  it("ignores an empty id without calling the API", async () => {
    const res = await settleCollectionById("");
    expect(h.verifyTransaction).not.toHaveBeenCalled();
    expect(res.outcome).toBe("ignored");
  });

  it("propagates a verify failure (so the webhook can 500 and retry)", async () => {
    h.verifyTransaction.mockRejectedValue(new Error("network"));
    await expect(settleCollectionById("abc")).rejects.toThrow("network");
  });
});
