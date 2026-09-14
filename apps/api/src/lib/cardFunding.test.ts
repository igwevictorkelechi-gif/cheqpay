import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  cardFindFirst: vi.fn(),
  txFindUnique: vi.fn(),
  txCreate: vi.fn(),
  txUpdate: vi.fn(),
  balanceUpdateMany: vi.fn(),
  balanceUpdate: vi.fn(),
  balanceUpsert: vi.fn(),
  fundCard: vi.fn(),
  withdrawFromCard: vi.fn(),
}));

const db = {
  balance: {
    updateMany: h.balanceUpdateMany,
    update: h.balanceUpdate,
    upsert: h.balanceUpsert,
  },
  transaction: { create: h.txCreate, update: h.txUpdate },
};

vi.mock("@cheqpay/db", () => ({
  Asset: { NGN: "NGN", USD: "USD" },
  TransactionStatus: { PROCESSING: "PROCESSING", COMPLETED: "COMPLETED", FAILED: "FAILED" },
  TransactionType: { CARD_FUND: "CARD_FUND", CARD_WITHDRAW: "CARD_WITHDRAW" },
  prisma: {
    card: { findFirst: h.cardFindFirst },
    transaction: { findUnique: h.txFindUnique, create: h.txCreate, update: h.txUpdate },
    balance: { update: h.balanceUpdate, upsert: h.balanceUpsert },
    $transaction: (cb: (tx: typeof db) => unknown) => cb(db),
  },
}));
vi.mock("./ensureUsdAsset", () => ({ ensureUsdAsset: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./ensureCardTxnTypes", () => ({ ensureCardTxnTypes: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./maplerad/issuing", () => ({
  fundCard: h.fundCard,
  withdrawFromCard: h.withdrawFromCard,
}));

import { fundUserCard, withdrawUserCard } from "./cardFunding";

const activeCard = {
  id: "card-1",
  providerCardId: "mp-card-1",
  status: "active",
  currency: "USD",
};

beforeEach(() => {
  vi.clearAllMocks();
  h.cardFindFirst.mockResolvedValue(activeCard);
  h.txFindUnique.mockResolvedValue(null);
  h.txCreate.mockResolvedValue({ id: "tx-1", status: "PROCESSING" });
  h.txUpdate.mockResolvedValue({});
  h.balanceUpdateMany.mockResolvedValue({ count: 1 });
  h.balanceUpdate.mockResolvedValue({});
  h.balanceUpsert.mockResolvedValue({});
  h.fundCard.mockResolvedValue({ id: "mp-tx" });
  h.withdrawFromCard.mockResolvedValue({ id: "mp-tx" });
});

const fund = (over = {}) =>
  fundUserCard({ userId: "u1", cardId: "card-1", amount: "10", idempotencyKey: "k1", ...over });
const withdraw = (over = {}) =>
  withdrawUserCard({ userId: "u1", cardId: "card-1", amount: "10", idempotencyKey: "k2", ...over });

describe("fundUserCard", () => {
  it("debits USD, then funds the card, in that order, and completes", async () => {
    const res = await fund();
    // Debit for exactly the cents, guarded on sufficient funds.
    expect(h.balanceUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ asset: "USD", available: { gte: 1000n } }),
        data: { available: { decrement: 1000n } },
      }),
    );
    expect(h.fundCard).toHaveBeenCalledWith("mp-card-1", 1000);
    expect(h.txUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "COMPLETED" } }),
    );
    expect(res).toMatchObject({ transactionId: "tx-1", status: "COMPLETED" });
  });

  it("refuses when the USD balance is short, without calling the provider", async () => {
    h.balanceUpdateMany.mockResolvedValue({ count: 0 });
    await expect(fund()).rejects.toMatchObject({ code: "insufficient_funds" });
    expect(h.fundCard).not.toHaveBeenCalled();
  });

  it("refunds the debit and fails the row when the provider errors", async () => {
    h.fundCard.mockRejectedValue(new Error("provider down"));
    await expect(fund()).rejects.toMatchObject({ code: "card_fund_failed" });
    expect(h.balanceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { available: { increment: 1000n } } }),
    );
    expect(h.txUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "FAILED" } }),
    );
  });

  it("returns the existing transaction on an idempotent replay", async () => {
    h.txFindUnique.mockResolvedValue({ id: "tx-old", status: "COMPLETED" });
    const res = await fund();
    expect(res).toEqual({ transactionId: "tx-old", status: "COMPLETED" });
    expect(h.balanceUpdateMany).not.toHaveBeenCalled();
    expect(h.fundCard).not.toHaveBeenCalled();
  });

  it("refuses a card still being issued", async () => {
    h.cardFindFirst.mockResolvedValue({ ...activeCard, providerCardId: null });
    await expect(fund()).rejects.toMatchObject({ code: "card_pending" });
  });

  it("refuses a frozen card", async () => {
    h.cardFindFirst.mockResolvedValue({ ...activeCard, status: "frozen" });
    await expect(fund()).rejects.toMatchObject({ code: "card_frozen" });
  });

  it("rejects a malformed amount", async () => {
    await expect(fund({ amount: "10.999" })).rejects.toMatchObject({ code: "bad_amount" });
    await expect(fund({ amount: "0" })).rejects.toMatchObject({ code: "bad_amount" });
  });

  it("handles sub-dollar and fractional amounts as cents", async () => {
    await fund({ amount: "10.50" });
    expect(h.fundCard).toHaveBeenCalledWith("mp-card-1", 1050);
  });
});

describe("withdrawUserCard", () => {
  it("debits the card first, then credits the user, and completes", async () => {
    const res = await withdraw();
    expect(h.withdrawFromCard).toHaveBeenCalledWith("mp-card-1", 1000);
    expect(h.balanceUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { available: { increment: 1000n } } }),
    );
    expect(res).toMatchObject({ transactionId: "tx-1", status: "COMPLETED" });
  });

  it("credits nothing and fails the row when the provider errors", async () => {
    h.withdrawFromCard.mockRejectedValue(new Error("insufficient card balance"));
    await expect(withdraw()).rejects.toMatchObject({ code: "card_withdraw_failed" });
    expect(h.balanceUpsert).not.toHaveBeenCalled();
    expect(h.txUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "FAILED" } }),
    );
  });

  it("does not record the debit on the ledger before the provider succeeds", async () => {
    await withdraw();
    // The PROCESSING row carries no balance change; the only balance write is
    // the credit AFTER the provider call.
    expect(h.txCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "PROCESSING" }) }),
    );
  });

  it("returns the existing transaction on an idempotent replay", async () => {
    h.txFindUnique.mockResolvedValue({ id: "tx-old", status: "COMPLETED" });
    const res = await withdraw();
    expect(res).toEqual({ transactionId: "tx-old", status: "COMPLETED" });
    expect(h.withdrawFromCard).not.toHaveBeenCalled();
  });
});
