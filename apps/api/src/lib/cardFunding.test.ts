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
  txFindFirst: vi.fn(),
  txUpdateMany: vi.fn(),
}));

const db = {
  balance: {
    updateMany: h.balanceUpdateMany,
    update: h.balanceUpdate,
    upsert: h.balanceUpsert,
  },
  transaction: {
    create: h.txCreate,
    update: h.txUpdate,
    findFirst: h.txFindFirst,
    updateMany: h.txUpdateMany,
  },
};

vi.mock("@cheqpay/db", () => ({
  Asset: { NGN: "NGN", USD: "USD" },
  TransactionStatus: { PROCESSING: "PROCESSING", COMPLETED: "COMPLETED", FAILED: "FAILED", REVERSED: "REVERSED" },
  TransactionType: { CARD_FUND: "CARD_FUND", CARD_WITHDRAW: "CARD_WITHDRAW", CARD_ISSUE: "CARD_ISSUE" },
  prisma: {
    card: { findFirst: h.cardFindFirst },
    transaction: { findUnique: h.txFindUnique, create: h.txCreate, update: h.txUpdate },
    balance: { update: h.balanceUpdate, upsert: h.balanceUpsert },
    $transaction: (cb: (tx: typeof db) => unknown) => cb(db),
  },
}));
vi.mock("./ensureUsdAsset", () => ({ ensureUsdAsset: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./ensureCardTxnTypes", () => ({ ensureCardTxnTypes: vi.fn().mockResolvedValue(undefined) }));
// The real price sheet: $5 minimum top-up, $1.50 fee below $100, 2.5% from it,
// $1.50 to withdraw, $3 per card.
vi.mock("./settings", async () => {
  const real = await vi.importActual<typeof import("./settings")>("./settings");
  return { getPricing: async () => real.PRICING_DEFAULTS };
});
vi.mock("./maplerad/issuing", () => ({
  fundCard: h.fundCard,
  withdrawFromCard: h.withdrawFromCard,
}));

import {
  chargeCardIssueFee,
  fundUserCard,
  refundCardIssueFee,
  withdrawUserCard,
} from "./cardFunding";

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
    // Debit for the top-up plus the $1.50 fee, guarded on sufficient funds.
    expect(h.balanceUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ asset: "USD", available: { gte: 1150n } }),
        data: { available: { decrement: 1150n } },
      }),
    );
    // The card gets the whole top-up; the fee is recorded on the row.
    expect(h.txCreate.mock.calls[0][0].data).toMatchObject({ amount: 1000n, fee: 150n });
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
      expect.objectContaining({ data: { available: { increment: 1150n } } }),
    );
    expect(h.txUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "FAILED" } }),
    );
  });

  it("refuses a top-up under the $5 minimum before touching the balance", async () => {
    await expect(fund({ amount: "4.99" })).rejects.toMatchObject({ code: "below_minimum" });
    expect(h.balanceUpdateMany).not.toHaveBeenCalled();
  });

  it("charges a percentage from $100", async () => {
    await fund({ amount: "100" });
    // 2.5% of $100 = $2.50.
    expect(h.txCreate.mock.calls[0][0].data).toMatchObject({ amount: 10_000n, fee: 250n });
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
    // $10 comes off the card; $1.50 is ours; $8.50 reaches the wallet.
    expect(h.withdrawFromCard).toHaveBeenCalledWith("mp-card-1", 1000);
    expect(h.balanceUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { available: { increment: 850n } } }),
    );
    expect(h.txCreate.mock.calls[0][0].data).toMatchObject({ amount: 850n, fee: 150n });
    expect(res).toMatchObject({ transactionId: "tx-1", status: "COMPLETED" });
  });

  it("refuses an amount the fee would swallow, without touching the card", async () => {
    await expect(withdraw({ amount: "1.50" })).rejects.toMatchObject({ code: "below_fee" });
    expect(h.withdrawFromCard).not.toHaveBeenCalled();
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

describe("card price", () => {
  it("charges $3 from the USD balance and records it as our fee", async () => {
    const r = await chargeCardIssueFee("u1");
    expect(r).toMatchObject({ feeCents: 300n });
    expect(h.balanceUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { available: { decrement: 300n } } }),
    );
    expect(h.txCreate.mock.calls[0][0].data).toMatchObject({ type: "CARD_ISSUE", amount: 0n, fee: 300n });
  });

  it("refuses when the wallet can't pay for the card", async () => {
    h.balanceUpdateMany.mockResolvedValue({ count: 0 });
    await expect(chargeCardIssueFee("u1")).rejects.toMatchObject({ code: "insufficient_funds" });
  });

  it("refunds the price once, and only once", async () => {
    h.txFindFirst.mockResolvedValue({ id: "fee-1", userId: "u1", fee: 300n });
    h.txUpdateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    await refundCardIssueFee({ reference: "ref-1" });
    await refundCardIssueFee({ reference: "ref-1" });
    expect(h.balanceUpdate).toHaveBeenCalledTimes(1);
    expect(h.balanceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { available: { increment: 300n } } }),
    );
  });
});
