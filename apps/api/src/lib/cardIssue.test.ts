import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  userFind: vi.fn(),
  cardFindFirst: vi.fn(),
  cardCreate: vi.fn(),
  cardUpdate: vi.fn(),
  cardUpdateMany: vi.fn(),
  cardDeleteMany: vi.fn(),
  txFindUnique: vi.fn(),
  txCreate: vi.fn(),
  txUpdate: vi.fn(),
  txUpdateMany: vi.fn(),
  balanceUpdateMany: vi.fn(),
  balanceUpdate: vi.fn(),
  audit: vi.fn(),
  charge: vi.fn(),
  refund: vi.fn(),
  createCard: vi.fn(),
  treasury: vi.fn(),
  alert: vi.fn(),
}));

const db = {
  card: { updateMany: h.cardUpdateMany, update: h.cardUpdate },
  balance: { updateMany: h.balanceUpdateMany, update: h.balanceUpdate },
  transaction: { create: h.txCreate, update: h.txUpdate, updateMany: h.txUpdateMany },
};

vi.mock("@cheqpay/db", () => ({
  Asset: { USD: "USD" },
  TransactionStatus: { PROCESSING: "PROCESSING", COMPLETED: "COMPLETED", FAILED: "FAILED" },
  TransactionType: { CARD_FUND: "CARD_FUND", CARD_ISSUE: "CARD_ISSUE" },
  prisma: {
    user: { findUnique: h.userFind },
    card: {
      findFirst: h.cardFindFirst,
      create: h.cardCreate,
      update: h.cardUpdate,
      updateMany: h.cardUpdateMany,
      deleteMany: h.cardDeleteMany,
    },
    transaction: { findUnique: h.txFindUnique, update: h.txUpdate, updateMany: h.txUpdateMany },
    auditLog: { create: h.audit },
    $transaction: (arg: unknown) =>
      typeof arg === "function" ? (arg as (d: typeof db) => unknown)(db) : Promise.all(arg as unknown[]),
  },
}));
vi.mock("./ensureCards", () => ({ ensureCardsTable: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./ensureUsdAsset", () => ({ ensureUsdAsset: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./ensureCardTxnTypes", () => ({ ensureCardTxnTypes: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./cardFunding", () => ({ chargeCardIssueFee: h.charge, refundCardIssueFee: h.refund }));
vi.mock("./settings", () => ({
  getPricing: vi.fn().mockResolvedValue({
    cardIssueFeeUsd: 3,
    cardFundMinUsd: 5,
    cardFundFeeSmallUsd: 1.5,
    cardFundFeeLargeBps: 250,
    cardFundThresholdUsd: 100,
  }),
}));
vi.mock("./maplerad/issuing", () => ({ createCard: h.createCard }));
vi.mock("./maplerad/treasury", () => ({ getProviderBalanceMinor: h.treasury }));
vi.mock("./opsAlert", () => ({ alertOpsOnce: h.alert }));

import { activateCard, cancelUnfundedCard, payForCard, slotRef } from "./cardIssue";

const activate = (amount = "10") =>
  activateCard({ userId: "u1", cardId: "c1", amount, idempotencyKey: "k1" });

beforeEach(() => {
  vi.clearAllMocks();
  h.userFind.mockResolvedValue({ mapleradCustomerId: "cust-1" });
  h.cardFindFirst.mockResolvedValue(null);
  h.cardCreate.mockResolvedValue({ id: "c1", status: "unfunded" });
  h.charge.mockResolvedValue({ transactionId: "fee-1", feeCents: 300n });
  h.txFindUnique.mockResolvedValue(null);
  h.cardUpdateMany.mockResolvedValue({ count: 1 });
  h.balanceUpdateMany.mockResolvedValue({ count: 1 });
  h.txCreate.mockResolvedValue({ id: "fund-1" });
  h.txUpdateMany.mockResolvedValue({ count: 1 });
  h.cardUpdate.mockResolvedValue({ id: "c1", status: "pending" });
  h.treasury.mockResolvedValue(100_000n);
  h.createCard.mockResolvedValue({ reference: "ref-9" });
  h.audit.mockResolvedValue({});
  h.alert.mockResolvedValue(true);
});

describe("payForCard (step 1)", () => {
  it("charges the card fee and reserves an unfunded card, without calling Maplerad", async () => {
    const r = await payForCard("u1", "req-1");
    expect(r.feeCents).toBe(300n);
    expect(h.cardCreate.mock.calls[0][0].data.status).toBe("unfunded");
    expect(h.txUpdate.mock.calls[0][0].data.externalRef).toBe(slotRef("c1"));
    expect(h.createCard).not.toHaveBeenCalled();
  });

  it("returns a paid, unfunded card instead of charging again", async () => {
    h.cardFindFirst.mockResolvedValue({ id: "c0", status: "unfunded" });
    const r = await payForCard("u1", "req-2");
    expect(r.alreadyPaid).toBe(true);
    expect(h.charge).not.toHaveBeenCalled();
  });

  it("needs KYC before charging", async () => {
    h.userFind.mockResolvedValue({ mapleradCustomerId: null });
    await expect(payForCard("u1", "req-3")).rejects.toMatchObject({ code: "kyc_required" });
    expect(h.charge).not.toHaveBeenCalled();
  });
});

describe("activateCard (step 2)", () => {
  beforeEach(() => {
    h.cardFindFirst.mockResolvedValue({ id: "c1", status: "unfunded" });
  });

  it("debits top-up + fee, creates the card with the top-up loaded, and links both money rows", async () => {
    await activate("10");
    // $10 top-up + $1.50 fee
    expect(h.balanceUpdateMany.mock.calls[0][0].data.available.decrement).toBe(1150n);
    expect(h.createCard).toHaveBeenCalledWith({ customerId: "cust-1", currency: "USD", amount: 1000 });
    expect(h.cardUpdate.mock.calls[0][0].data).toEqual({ status: "pending", reference: "ref-9" });
    // The card fee row is re-pointed from the slot to the card's reference.
    const relink = h.txUpdateMany.mock.calls.find((c) => c[0].where.externalRef === slotRef("c1"));
    expect(relink?.[0].data.externalRef).toBe("ref-9");
  });

  it("refuses a top-up under the minimum", async () => {
    await expect(activate("2")).rejects.toMatchObject({ code: "below_minimum" });
    expect(h.balanceUpdateMany).not.toHaveBeenCalled();
  });

  it("says how much is needed when the USD balance is short", async () => {
    h.balanceUpdateMany.mockResolvedValue({ count: 0 });
    await expect(activate("10")).rejects.toMatchObject({ code: "insufficient_funds" });
    expect(h.createCard).not.toHaveBeenCalled();
  });

  it("refunds the top-up and reopens the slot when Maplerad refuses", async () => {
    h.createCard.mockRejectedValue(new Error("upstream unreachable"));
    await expect(activate("10")).rejects.toMatchObject({ code: "card_issuing_unavailable" });
    expect(h.balanceUpdate.mock.calls[0][0].data.available.increment).toBe(1150n);
    const reopen = h.cardUpdateMany.mock.calls.find((c) => c[0].data.status === "unfunded");
    expect(reopen).toBeTruthy();
    expect(h.audit.mock.calls[0][0].data.action).toBe("card.issue_failed");
  });

  it("refuses before touching the customer's money when the business USD wallet can't cover the load", async () => {
    h.treasury.mockResolvedValue(243n);
    await expect(activate("10")).rejects.toMatchObject({ code: "card_issuing_unavailable" });
    expect(h.balanceUpdateMany).not.toHaveBeenCalled();
    expect(h.alert).toHaveBeenCalled();
  });

  it("won't activate a card that isn't waiting for funding", async () => {
    h.cardFindFirst.mockResolvedValue({ id: "c1", status: "active" });
    await expect(activate("10")).rejects.toMatchObject({ code: "card_not_unfunded" });
  });
});

describe("cancelUnfundedCard", () => {
  it("removes the slot and refunds its fee", async () => {
    h.cardDeleteMany.mockResolvedValue({ count: 1 });
    await cancelUnfundedCard("u1", "c1");
    expect(h.refund).toHaveBeenCalledWith({ reference: slotRef("c1") });
  });

  it("refuses for a card that has been funded", async () => {
    h.cardDeleteMany.mockResolvedValue({ count: 0 });
    await expect(cancelUnfundedCard("u1", "c1")).rejects.toMatchObject({ code: "card_not_unfunded" });
    expect(h.refund).not.toHaveBeenCalled();
  });
});
