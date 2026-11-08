import { describe, expect, it } from "vitest";
import {
  MAX_COUNT,
  allocateArrears,
  breakFee,
  groupProblem,
  inviteCode,
  nextDueAfter,
  normaliseInviteCode,
  payoutOrder,
  planProblem,
} from "./rules";

const LIMIT = 50_000_000n; // ₦500,000 per transaction

describe("nextDueAfter", () => {
  it("is 08:00 UTC the next day, week or month", () => {
    const from = new Date("2026-03-10T15:42:00Z");
    expect(nextDueAfter(from, "daily").toISOString()).toBe("2026-03-11T08:00:00.000Z");
    expect(nextDueAfter(from, "weekly").toISOString()).toBe("2026-03-17T08:00:00.000Z");
    expect(nextDueAfter(from, "monthly").toISOString()).toBe("2026-04-10T08:00:00.000Z");
  });

  it("clamps the 31st to the end of a shorter month", () => {
    expect(nextDueAfter(new Date("2026-01-31T08:00:00Z"), "monthly").toISOString()).toBe("2026-02-28T08:00:00.000Z");
    expect(nextDueAfter(new Date("2028-01-31T08:00:00Z"), "monthly").toISOString()).toBe("2028-02-29T08:00:00.000Z");
    expect(nextDueAfter(new Date("2026-12-31T08:00:00Z"), "monthly").toISOString()).toBe("2027-01-31T08:00:00.000Z");
  });
});

describe("breakFee", () => {
  it("is basis points of what was saved, rounded down", () => {
    expect(breakFee(1_000_000n, 100)).toBe(10_000n); // 1% of ₦10,000 = ₦100
    expect(breakFee(999n, 100)).toBe(9n);
  });
  it("is nothing on nothing saved or a zero rate", () => {
    expect(breakFee(0n, 100)).toBe(0n);
    expect(breakFee(1_000_000n, 0)).toBe(0n);
  });
});

describe("planProblem", () => {
  const ok = { amountKobo: 500_000n, frequency: "weekly" as const, count: 12 };
  it("accepts a normal plan", () => expect(planProblem(ok, LIMIT)).toBeNull());
  it("refuses under ₦100", () => expect(planProblem({ ...ok, amountKobo: 9_999n }, LIMIT)).toMatch(/smallest/));
  it("refuses above the per-transaction limit", () => expect(planProblem({ ...ok, amountKobo: LIMIT + 1n }, LIMIT)).toMatch(/limit/));
  it("needs at least 2 contributions", () => expect(planProblem({ ...ok, count: 1 }, LIMIT)).toMatch(/at least 2/));
  it("caps the length per frequency", () => {
    expect(planProblem({ ...ok, frequency: "monthly", count: MAX_COUNT.monthly }, LIMIT)).toBeNull();
    expect(planProblem({ ...ok, frequency: "monthly", count: MAX_COUNT.monthly + 1 }, LIMIT)).toMatch(/at most/);
  });
});

describe("groupProblem", () => {
  const ok = { amountKobo: 1_000_000n, frequency: "monthly" as const, size: 10 };
  it("accepts a normal group", () => expect(groupProblem(ok, LIMIT)).toBeNull());
  it("needs 2 to 30 members", () => {
    expect(groupProblem({ ...ok, size: 1 }, LIMIT)).toMatch(/between/);
    expect(groupProblem({ ...ok, size: 31 }, LIMIT)).toMatch(/between/);
  });
  it("caps the pot at ₦20m", () => {
    expect(groupProblem({ amountKobo: 100_000_000n, frequency: "monthly", size: 30 }, 200_000_000n)).toMatch(/20,000,000/);
  });
});

describe("invite codes", () => {
  it("are 6 characters from an alphabet without look-alikes", () => {
    for (let i = 0; i < 200; i++) expect(inviteCode()).toMatch(/^[A-HJKMNP-Z2-9]{6}$/);
  });
  it("normalise what people type", () => expect(normaliseInviteCode("  ab3-k9z ")).toBe("AB3K9Z"));
});

describe("payoutOrder", () => {
  const joined = ["a", "b", "c", "d", "e"];
  it("keeps join order when asked", () => expect(payoutOrder(joined, "join")).toEqual(joined));
  it("shuffles into a permutation of the members", () => {
    const out = payoutOrder(joined, "random");
    expect([...out].sort()).toEqual(joined);
  });
  it("uses the random source it is given (Fisher–Yates)", () => {
    // rand always 0: each element swaps with index 0 in turn.
    expect(payoutOrder(["a", "b", "c"], "random", () => 0)).toEqual(["b", "c", "a"]);
  });
});

describe("allocateArrears", () => {
  const owed = [
    { id: "r1", owedKobo: 500n },
    { id: "r2", owedKobo: 500n },
  ];
  it("pays the oldest first and allows a part payment", () => {
    expect(allocateArrears(700n, owed)).toEqual([
      { id: "r1", payKobo: 500n },
      { id: "r2", payKobo: 200n },
    ]);
  });
  it("never takes more than is owed", () => {
    expect(allocateArrears(5_000n, owed).reduce((s, x) => s + x.payKobo, 0n)).toBe(1_000n);
  });
  it("takes nothing from an empty wallet", () => expect(allocateArrears(0n, owed)).toEqual([]));
});
