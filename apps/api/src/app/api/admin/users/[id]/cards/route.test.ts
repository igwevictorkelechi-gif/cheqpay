import { beforeEach, describe, expect, it, vi } from "vitest";

// An admin creates a virtual card for a user, paid from the user's own USD
// balance. The money rules: check the whole cost first, and if the card isn't
// created, refund a card fee this request charged.

const h = vi.hoisted(() => ({
  requireAdminActor: vi.fn(),
  requireAdminOtp: vi.fn(),
  recordAdminAction: vi.fn(),
  userFind: vi.fn(),
  cardFindFirst: vi.fn(),
  balanceFind: vi.fn(),
  payForCard: vi.fn(),
  activateCard: vi.fn(),
  cancelUnfundedCard: vi.fn(),
  notifyUser: vi.fn(),
}));

vi.mock("@cheqpay/db", () => ({
  Asset: { USD: "USD" },
  UserStatus: { ACTIVE: "ACTIVE" },
  prisma: {
    user: { findUnique: h.userFind },
    card: { findFirst: h.cardFindFirst, findMany: vi.fn() },
    balance: { findUnique: h.balanceFind },
  },
}));
vi.mock("@/lib/auth", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/adminGuard", () => ({
  requireAdminActor: h.requireAdminActor,
  requireAdminOtp: h.requireAdminOtp,
  recordAdminAction: h.recordAdminAction,
}));
vi.mock("@/lib/ratelimit", () => ({ enforceRateLimit: vi.fn() }));
vi.mock("@/lib/ensureCards", () => ({ ensureCardsTable: vi.fn() }));
vi.mock("@/lib/cards", () => ({ cardsAvailable: () => true }));
vi.mock("@/lib/cardIssue", () => ({
  UNFUNDED: "unfunded",
  payForCard: h.payForCard,
  activateCard: h.activateCard,
  cancelUnfundedCard: h.cancelUnfundedCard,
}));
vi.mock("@/lib/settings", () => ({
  getPricing: vi.fn().mockResolvedValue({
    cardIssueFeeUsd: 3,
    cardFundMinUsd: 5,
    cardFundFeeSmallUsd: 1.5,
    cardFundFeeLargeBps: 250,
    cardFundThresholdUsd: 100,
  }),
}));
vi.mock("@/lib/money", () => ({
  toMinorUnits: (a: string) => BigInt(Math.round(Number(a) * 100)),
  fromMinorUnits: (m: bigint) => (Number(m) / 100).toFixed(2),
}));
vi.mock("@/lib/alerts", () => ({ notifyUser: h.notifyUser }));

import { ApiError } from "@/lib/http";
import { POST } from "./route";

function call(body: Record<string, unknown> = {}) {
  return POST(
    new Request("https://api/x", {
      method: "POST",
      body: JSON.stringify({ amount: "10", reason: "Asked for it on support chat", otp: "123456", ...body }),
    }),
    { params: Promise.resolve({ id: "u1" }) },
  );
}

describe("POST /api/admin/users/[id]/cards", () => {
  beforeEach(() => {
    Object.values(h).forEach((fn) => fn.mockReset());
    h.requireAdminActor.mockResolvedValue({ email: "ops@cheqpay.com", role: "admin" });
    h.userFind.mockResolvedValue({ id: "u1", email: "ada@example.com", status: "ACTIVE", mapleradCustomerId: "cus_1" });
    h.cardFindFirst.mockResolvedValue(null);
    h.balanceFind.mockResolvedValue({ available: 2000n }); // $20.00
    h.payForCard.mockResolvedValue({ card: { id: "card_1" }, feeCents: 300n, alreadyPaid: false });
    h.activateCard.mockResolvedValue({ card: { id: "card_1", status: "pending" }, feeCents: 150n });
    h.notifyUser.mockResolvedValue({});
  });

  it("creates the card from the user's balance and records who did it", async () => {
    const res = await call();
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.charged).toBe("14.50"); // $3 card fee + $10 top-up + $1.50 top-up fee
    expect(h.requireAdminOtp).toHaveBeenCalled();
    expect(h.activateCard).toHaveBeenCalledWith(expect.objectContaining({ userId: "u1", cardId: "card_1", amount: "10" }));
    expect(h.recordAdminAction).toHaveBeenCalledWith(
      expect.anything(),
      { email: "ops@cheqpay.com", role: "admin" },
      expect.objectContaining({ action: "admin.card.created", userId: "u1", details: expect.objectContaining({ reason: "Asked for it on support chat" }) }),
    );
    expect(h.notifyUser).toHaveBeenCalledWith("u1", expect.objectContaining({ title: "Your virtual card is on its way" }));
  });

  it("refuses before charging anything when the balance can't cover the whole card", async () => {
    h.balanceFind.mockResolvedValue({ available: 1200n }); // $12 < $14.50
    const res = await call();
    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain("needs $14.50");
    expect(h.payForCard).not.toHaveBeenCalled();
  });

  it("refunds the card fee it charged when the card isn't created", async () => {
    h.activateCard.mockRejectedValue(new ApiError(502, "x", "card_issuing_unavailable"));
    const res = await call();
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain("nothing was charged");
    expect(h.cancelUnfundedCard).toHaveBeenCalledWith("u1", "card_1");
    expect(h.recordAdminAction).not.toHaveBeenCalled();
  });

  it("leaves a card fee the user had already paid on their unfinished card", async () => {
    h.cardFindFirst.mockResolvedValue({ id: "card_0" });
    h.payForCard.mockResolvedValue({ card: { id: "card_0" }, feeCents: 0n, alreadyPaid: true });
    h.activateCard.mockRejectedValue(new ApiError(502, "x", "card_issuing_unavailable"));
    const res = await call();
    expect(res.status).toBe(502);
    expect(h.cancelUnfundedCard).not.toHaveBeenCalled();
  });

  it("needs no card fee when the user already has a paid, unfinished card", async () => {
    h.cardFindFirst.mockResolvedValue({ id: "card_0" });
    h.balanceFind.mockResolvedValue({ available: 1150n }); // exactly $10 + $1.50
    h.payForCard.mockResolvedValue({ card: { id: "card_0" }, feeCents: 0n, alreadyPaid: true });
    const res = await call();
    expect(res.status).toBe(201);
    expect((await res.json()).charged).toBe("11.50");
  });

  it("won't create a card for a user who isn't enrolled with Maplerad", async () => {
    h.userFind.mockResolvedValue({ id: "u1", email: "ada@example.com", status: "ACTIVE", mapleradCustomerId: null });
    const res = await call();
    expect(res.status).toBe(409);
    expect(h.payForCard).not.toHaveBeenCalled();
  });

  it("asks for a reason", async () => {
    const res = await call({ reason: "short" });
    expect(res.status).toBe(422);
    expect(h.payForCard).not.toHaveBeenCalled();
  });
});
