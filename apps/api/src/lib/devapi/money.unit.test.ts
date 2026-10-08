import { describe, expect, it } from "vitest";
import { addMonth, liveAccessProblem, prorate, GRACE_MS } from "./billing";
import { PLAN_DEFAULTS, mergePlans } from "./plans";
import { LIMIT_DEFAULTS, effectiveLimits, mergeLimits } from "./limits";
import { startOfLagosDay } from "./ledger";
import { currentPlan } from "./handler";
import type { AccountRow, SubscriptionRow } from "./types";

const d = (s: string) => new Date(s);

describe("billing periods", () => {
  it("add one calendar month, clamped to the month's end", () => {
    expect(addMonth(d("2026-01-31T10:00:00Z")).toISOString()).toBe("2026-02-28T10:00:00.000Z");
    expect(addMonth(d("2028-01-31T10:00:00Z")).toISOString()).toBe("2028-02-29T10:00:00.000Z");
    expect(addMonth(d("2026-12-15T00:00:00Z")).toISOString()).toBe("2027-01-15T00:00:00.000Z");
    expect(addMonth(d("2026-03-31T23:59:59Z")).toISOString()).toBe("2026-04-30T23:59:59.000Z");
  });

  it("prorate an upgrade by the time left, rounding up to the kobo", () => {
    const start = d("2026-10-01T00:00:00Z");
    const end = d("2026-10-31T00:00:00Z");
    // Halfway through: half the ₦35,000 difference.
    expect(prorate(1_500_000, 5_000_000, start, end, d("2026-10-16T00:00:00Z"))).toBe(1_750_000n);
    // Downgrades and same price cost nothing now.
    expect(prorate(5_000_000, 1_500_000, start, end, d("2026-10-16T00:00:00Z"))).toBe(0n);
    expect(prorate(1_500_000, 1_500_000, start, end, d("2026-10-16T00:00:00Z"))).toBe(0n);
    // Before the period: the full difference; after it: nothing.
    expect(prorate(1_500_000, 5_000_000, start, end, d("2026-09-01T00:00:00Z"))).toBe(3_500_000n);
    expect(prorate(1_500_000, 5_000_000, start, end, d("2026-11-01T00:00:00Z"))).toBe(0n);
    // Rounds up, never down.
    expect(prorate(0, 1, start, end, d("2026-10-30T00:00:00Z"))).toBe(1n);
  });
});

describe("live access", () => {
  const plans = mergePlans(null);
  const now = d("2026-10-20T00:00:00Z");
  const sub = (over: Partial<SubscriptionRow> = {}): SubscriptionRow => ({
    account_id: "a",
    plan_id: "starter",
    status: "active",
    current_period_start: d("2026-10-10T00:00:00Z"),
    current_period_end: d("2026-11-10T00:00:00Z"),
    cancel_at_period_end: false,
    next_plan_id: null,
    past_due_since: null,
    created_at: now,
    updated_at: now,
    ...over,
  });
  const approved = { status: "approved" as const };

  it("needs a verified business", () => {
    expect(liveAccessProblem({ status: "sandbox" }, sub(), plans, now)?.code).toBe("account_not_approved");
    expect(liveAccessProblem({ status: "pending_review" }, sub(), plans, now)?.code).toBe("account_not_approved");
    expect(liveAccessProblem({ status: "suspended" }, sub(), plans, now)?.code).toBe("account_not_approved");
  });

  it("needs a current paid plan", () => {
    expect(liveAccessProblem(approved, null, plans, now)?.code).toBe("subscription_inactive");
    expect(liveAccessProblem(approved, sub({ plan_id: "sandbox" }), plans, now)?.code).toBe("subscription_inactive");
    expect(liveAccessProblem(approved, sub({ status: "canceled" }), plans, now)?.code).toBe("subscription_inactive");
    expect(liveAccessProblem(approved, sub(), plans, now)).toBeNull();
  });

  it("allows 3 days' grace on a missed renewal, then stops", () => {
    const ended = d("2026-10-19T00:00:00Z");
    expect(liveAccessProblem(approved, sub({ current_period_end: ended }), plans, now)).toBeNull();
    expect(liveAccessProblem(approved, sub({ status: "past_due", past_due_since: ended }), plans, now)).toBeNull();
    const longAgo = new Date(now.getTime() - GRACE_MS - 1);
    expect(liveAccessProblem(approved, sub({ status: "past_due", past_due_since: longAgo }), plans, now)?.code).toBe("subscription_inactive");
    expect(liveAccessProblem(approved, sub({ current_period_end: longAgo }), plans, now)?.code).toBe("subscription_inactive");
  });

  it("sets the rate limit by the plan in force", () => {
    expect(currentPlan(sub({ plan_id: "growth" }), plans).id).toBe("growth");
    expect(currentPlan(sub({ status: "canceled", plan_id: "growth" }), plans).id).toBe("sandbox");
    expect(currentPlan(null, plans).id).toBe("sandbox");
  });
});

describe("plans and limits from settings", () => {
  it("merge field by field inside bounds, and the sandbox stays free", () => {
    const merged = mergePlans({
      starter: { priceMinor: 2_000_000, rpm: 0, billFeeBps: 99_999, name: "Starter+" },
      sandbox: { priceMinor: 5_000_000, live: true },
      growth: "corrupt",
    });
    expect(merged.starter.priceMinor).toBe(2_000_000);
    expect(merged.starter.rpm).toBe(PLAN_DEFAULTS.starter.rpm); // 0 is out of bounds
    expect(merged.starter.billFeeBps).toBe(PLAN_DEFAULTS.starter.billFeeBps);
    expect(merged.starter.name).toBe("Starter+");
    expect(merged.sandbox.priceMinor).toBe(0);
    expect(merged.sandbox.live).toBe(false);
    expect(merged.growth).toEqual(PLAN_DEFAULTS.growth);
    expect(mergePlans("nonsense")).toEqual(PLAN_DEFAULTS);
  });

  it("run a new account on reduced daily limits, unless an admin set its own", () => {
    const now = d("2026-10-20T00:00:00Z");
    const base = {
      live_since: d("2026-10-10T00:00:00Z"),
      daily_out_limit_ngn: null,
      daily_out_limit_usd: null,
      max_float_ngn: null,
      max_float_usd: null,
    } as unknown as AccountRow;
    const fresh = effectiveLimits(base, LIMIT_DEFAULTS, now);
    expect(fresh.newAccount).toBe(true);
    expect(fresh.dailyOut.NGN).toBe(BigInt(LIMIT_DEFAULTS.newDailyOutNgnMinor));
    const older = effectiveLimits({ ...base, live_since: d("2026-08-01T00:00:00Z") }, LIMIT_DEFAULTS, now);
    expect(older.newAccount).toBe(false);
    expect(older.dailyOut.NGN).toBe(BigInt(LIMIT_DEFAULTS.dailyOutNgnMinor));
    const overridden = effectiveLimits({ ...base, daily_out_limit_ngn: 777n, max_float_usd: 5n }, LIMIT_DEFAULTS, now);
    expect(overridden.dailyOut.NGN).toBe(777n);
    expect(overridden.maxFloat.USD).toBe(5n);
    expect(mergeLimits({ dailyOutNgnMinor: -5, newAccountDays: 9999 })).toEqual(LIMIT_DEFAULTS);
  });

  it("reset daily limits at midnight in Lagos", () => {
    expect(startOfLagosDay(d("2026-10-20T22:59:59Z")).toISOString()).toBe("2026-10-19T23:00:00.000Z");
    expect(startOfLagosDay(d("2026-10-20T23:00:00Z")).toISOString()).toBe("2026-10-20T23:00:00.000Z");
    expect(startOfLagosDay(d("2026-10-20T00:30:00Z")).toISOString()).toBe("2026-10-19T23:00:00.000Z");
  });
});
