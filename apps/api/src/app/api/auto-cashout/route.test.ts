import { beforeEach, describe, expect, it, vi } from "vitest";

/** Auto cash-out settings: who can turn payouts on, and to which account. */

const h = vi.hoisted(() => ({
  beneficiaryFindFirst: vi.fn(),
  requirePin: vi.fn(),
  save: vi.fn(),
  current: { enabled: false, assets: [] as string[], beneficiaryId: null as string | null },
  notifyUser: vi.fn(),
  flags: { auto_cashout: true },
}));

vi.mock("@cheqpay/db", () => ({
  prisma: {
    beneficiary: { findFirst: h.beneficiaryFindFirst },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  },
}));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn().mockResolvedValue({ id: "u1" }) }));
vi.mock("@/lib/features", () => ({ getFeatureFlags: async () => h.flags }));
vi.mock("@/lib/ratelimit", () => ({ enforceRateLimit: vi.fn() }));
vi.mock("@/lib/transactionPin", () => ({ readPin: () => "1234", requireTransactionPin: h.requirePin }));
vi.mock("@/lib/settings", () => ({ getWithdrawalFeeNgn: async () => 200, getWithdrawalMinNgn: async () => 2000 }));
vi.mock("@/lib/alerts", () => ({ notifyUser: h.notifyUser }));
vi.mock("@/lib/autoCashout", () => ({
  getAutoCashoutSettings: async () => h.current,
  saveAutoCashoutSettings: h.save,
  listAutoCashouts: async () => [],
}));

import { PUT } from "./route";

const BEN = "11111111-1111-4111-8111-111111111111";
const put = (body: unknown) =>
  PUT(new Request("https://x/api/auto-cashout", { method: "PUT", body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  h.current = { enabled: false, assets: [], beneficiaryId: null };
  h.flags = { auto_cashout: true };
  h.beneficiaryFindFirst.mockResolvedValue({ id: BEN, bankName: "GTBank", accountNumber: "0123456789" });
  h.requirePin.mockResolvedValue(undefined);
  h.notifyUser.mockResolvedValue({});
});

describe("PUT /api/auto-cashout", () => {
  it("needs the transaction PIN to turn it on, and tells the owner", async () => {
    const res = await put({ enabled: true, assets: ["USDT"], beneficiaryId: BEN });
    expect(res.status).toBe(200);
    expect(h.requirePin).toHaveBeenCalledWith("u1", "1234");
    expect(h.save).toHaveBeenCalled();
    expect(h.notifyUser).toHaveBeenCalledWith("u1", expect.objectContaining({ category: "security", title: "Auto cash-out is on" }));
  });

  it("refuses a wrong PIN and saves nothing", async () => {
    h.requirePin.mockRejectedValue(Object.assign(new Error("Wrong PIN"), { status: 403, code: "bad_pin" }));
    const res = await put({ enabled: true, assets: ["USDT"], beneficiaryId: BEN });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(h.save).not.toHaveBeenCalled();
  });

  it("only pays to the caller's own saved accounts", async () => {
    h.beneficiaryFindFirst.mockResolvedValue(null); // not this user's account
    const res = await put({ enabled: true, assets: ["USDT"], beneficiaryId: BEN });
    expect(res.status).toBe(404);
    expect(h.beneficiaryFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: BEN, userId: "u1" } }));
    expect(h.save).not.toHaveBeenCalled();
  });

  it("needs the PIN again to change the account or add a coin", async () => {
    h.current = { enabled: true, assets: ["USDT"], beneficiaryId: "22222222-2222-4222-8222-222222222222" };
    await put({ enabled: true, assets: ["USDT"], beneficiaryId: BEN });
    expect(h.requirePin).toHaveBeenCalledTimes(1);
    h.current = { enabled: true, assets: ["USDT"], beneficiaryId: BEN };
    await put({ enabled: true, assets: ["USDT", "BTC"], beneficiaryId: BEN });
    expect(h.requirePin).toHaveBeenCalledTimes(2);
  });

  it("lets anyone signed in turn it off without the PIN", async () => {
    h.current = { enabled: true, assets: ["USDT"], beneficiaryId: BEN };
    const res = await put({ enabled: false, assets: ["USDT"], beneficiaryId: BEN });
    expect(res.status).toBe(200);
    expect(h.requirePin).not.toHaveBeenCalled();
    expect(h.save).toHaveBeenCalledWith("u1", expect.objectContaining({ enabled: false }));
  });

  it("can't be turned on while the feature is off", async () => {
    h.flags = { auto_cashout: false };
    const res = await put({ enabled: true, assets: ["USDT"], beneficiaryId: BEN });
    expect(res.status).toBe(503);
    expect(h.save).not.toHaveBeenCalled();
  });
});
