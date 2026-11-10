import { beforeEach, describe, expect, it, vi } from "vitest";

/** Ajo routes: the feature flag, the PIN, the ticked lien terms. */

const h = vi.hoisted(() => ({
  flags: { ajo: true } as Record<string, boolean>,
  requirePin: vi.fn(),
  createPlan: vi.fn(),
  joinGroup: vi.fn(),
  createGroup: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireUser: vi.fn().mockResolvedValue({ id: "u1" }) }));
vi.mock("@/lib/features", async () => {
  const { ApiError } = await import("@/lib/http");
  return {
    getFeatureFlags: async () => h.flags,
    assertFeatureEnabled: async (k: string) => {
      if (!h.flags[k]) throw new ApiError(503, "Ajo savings is temporarily unavailable.", "feature_disabled");
    },
  };
});
vi.mock("@/lib/ratelimit", () => ({ enforceRateLimit: vi.fn() }));
vi.mock("@/lib/transactionPin", () => ({ readPin: () => "1234", requireTransactionPin: h.requirePin }));
vi.mock("@/lib/ajo", () => ({ createPlan: h.createPlan, joinGroup: h.joinGroup, createGroup: h.createGroup }));

import { POST as postPlan } from "./plans/route";
import { POST as postJoin } from "./groups/join/route";
import { POST as postGroup } from "./groups/route";

const req = (body: unknown) => new Request("https://x/api/ajo", { method: "POST", body: JSON.stringify(body) });
const planRow = {
  id: "p1", user_id: "u1", name: "Rent", amount_minor: 500_000n, frequency: "weekly", total_count: 4,
  paid_count: 1, missed_count: 0, saved_minor: 500_000n, status: "active", next_due_at: null, closed_at: null, created_at: new Date(),
};
const groupRow = {
  id: "g1", owner_id: "u1", name: "Office", amount_minor: 1_000_000n, frequency: "monthly", size: 5, payout_order: "random",
  invite_code: "ABC234", status: "forming", current_round: 0, next_due_at: null, started_at: null, closed_at: null, created_at: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
  h.flags = { ajo: true };
  h.requirePin.mockResolvedValue(undefined);
  h.createPlan.mockResolvedValue(planRow);
  h.joinGroup.mockResolvedValue(groupRow);
  h.createGroup.mockResolvedValue(groupRow);
});

describe("POST /api/ajo/plans", () => {
  it("needs the PIN, converts naira to kobo and returns naira strings", async () => {
    const res = await postPlan(req({ name: "Rent", amount: "5000", frequency: "weekly", count: 4 }));
    expect(res.status).toBe(201);
    expect(h.requirePin).toHaveBeenCalledWith("u1", "1234");
    expect(h.createPlan).toHaveBeenCalledWith("u1", { name: "Rent", amountKobo: 500_000n, frequency: "weekly", count: 4 });
    const body = await res.json();
    expect(body.plan).toMatchObject({ amount: "5000.00", saved: "5000.00", target: "20000.00" });
  });

  it("creates nothing on a wrong PIN", async () => {
    h.requirePin.mockRejectedValue(Object.assign(new Error("Wrong PIN"), { status: 403 }));
    const res = await postPlan(req({ name: "Rent", amount: "5000", frequency: "weekly", count: 4 }));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(h.createPlan).not.toHaveBeenCalled();
  });

  it("is closed while the feature is off", async () => {
    h.flags = { ajo: false };
    const res = await postPlan(req({ name: "Rent", amount: "5000", frequency: "weekly", count: 4 }));
    expect(res.status).toBe(503);
    expect(h.createPlan).not.toHaveBeenCalled();
  });
});

describe("Ajo groups", () => {
  it("won't join without the lien terms ticked", async () => {
    const res = await postJoin(req({ code: "ABC234" }));
    expect(res.status).toBe(422);
    expect(h.joinGroup).not.toHaveBeenCalled();
  });

  it("joins with the PIN and the terms", async () => {
    const res = await postJoin(req({ code: "abc-234", acceptTerms: true }));
    expect(res.status).toBe(200);
    expect(h.requirePin).toHaveBeenCalled();
    expect(h.joinGroup).toHaveBeenCalledWith("u1", "abc-234");
  });

  it("creating a group needs the terms and the PIN too", async () => {
    const body = { name: "Office", amount: "10000", frequency: "monthly", size: 5 };
    expect((await postGroup(req(body))).status).toBe(422);
    const res = await postGroup(req({ ...body, acceptTerms: true }));
    expect(res.status).toBe(201);
    expect(h.requirePin).toHaveBeenCalled();
    expect((await res.json()).group).toMatchObject({ pot: "50000.00", inviteCode: "ABC234", isOrganiser: true });
  });
});
