import { describe, expect, it } from "vitest";
import { circleItem, nextAutopayAt, pickNextUp, type NextUpItem } from "./nextUp";

const NOW = new Date("2026-11-18T10:00:00Z");

describe("nextAutopayAt", () => {
  it("is this month's day when it is still ahead", () => {
    expect(nextAutopayAt(25, null, NOW).toISOString()).toBe("2026-11-25T07:05:00.000Z");
  });

  it("is next month once this month's day has passed", () => {
    expect(nextAutopayAt(10, null, NOW).toISOString()).toBe("2026-12-10T07:05:00.000Z");
  });

  it("is next month when it already ran this month, even if the day is ahead", () => {
    expect(nextAutopayAt(25, new Date("2026-11-03T07:06:00Z"), NOW).toISOString()).toBe("2026-12-25T07:05:00.000Z");
  });

  it("rolls December into January", () => {
    expect(nextAutopayAt(5, null, new Date("2026-12-20T00:00:00Z")).toISOString()).toBe("2027-01-05T07:05:00.000Z");
  });
});

describe("circleItem", () => {
  const g = { id: "g1", name: "Office Ajo", amount_minor: 2_500_000n, size: 10, current_round: 4, next_due_at: new Date("2026-11-23T08:00:00Z") };

  it("is the collector's turn when their position is the current round: everyone else's share arrives", () => {
    const item = circleItem(g, 4);
    expect(item.kind).toBe("ajo_collect");
    expect(item.direction).toBe("in");
    expect(item.amountMinor).toBe("22500000"); // 9 × ₦25,000 = ₦225,000 — own share never leaves
    expect(item.detail).toBe("Your turn — you collect");
  });

  it("is a contribution for everyone else", () => {
    const item = circleItem(g, 7);
    expect(item.kind).toBe("ajo_contribution");
    expect(item.direction).toBe("out");
    expect(item.amountMinor).toBe("2500000");
    expect(item.detail).toBe("Round 4 of 10");
  });

  it("is a contribution for a member with no position yet", () => {
    expect(circleItem(g, null).kind).toBe("ajo_contribution");
  });
});

describe("pickNextUp", () => {
  const item = (id: string, dueAt: string): NextUpItem => ({
    kind: "ajo_plan", id, title: id, detail: "", dueAt, amountMinor: "100", direction: "out",
  });

  it("orders soonest first and keeps three", () => {
    const picked = pickNextUp(
      [item("d", "2026-11-30T00:00:00Z"), item("a", "2026-11-19T00:00:00Z"), item("c", "2026-11-25T00:00:00Z"), item("b", "2026-11-20T00:00:00Z")],
      NOW,
    );
    expect(picked.map((i) => i.id)).toEqual(["a", "b", "c"]);
  });

  it("drops what is past and what is more than a month out", () => {
    const picked = pickNextUp([item("past", "2026-11-17T00:00:00Z"), item("far", "2027-01-30T00:00:00Z"), item("ok", "2026-12-01T00:00:00Z")], NOW);
    expect(picked.map((i) => i.id)).toEqual(["ok"]);
  });
});
