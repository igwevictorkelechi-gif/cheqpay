import { describe, expect, it } from "vitest";
import type { BillPlan } from "./bills";
import {
  bucketFor,
  formatSize,
  formatValidity,
  parseDays,
  parseVolumeMb,
  valueDataPlans,
} from "./dataPlanValue";

function plan(over: Partial<BillPlan> & { id: string; amount: string }): BillPlan {
  return { billerId: "mtn", name: "", ...over } as BillPlan;
}

describe("parseVolumeMb", () => {
  it("reads the units providers actually use", () => {
    expect(parseVolumeMb("1GB")).toBe(1024);
    expect(parseVolumeMb("1.5 GB")).toBe(1536);
    expect(parseVolumeMb("500MB")).toBe(500);
    expect(parseVolumeMb("1TB")).toBe(1024 * 1024);
    expect(parseVolumeMb("2GB · 30 days")).toBe(2048);
  });

  it("refuses an unlabelled number rather than guessing the unit", () => {
    expect(parseVolumeMb("20")).toBeNull();
    expect(parseVolumeMb("")).toBeNull();
    expect(parseVolumeMb(null)).toBeNull();
  });
});

describe("parseDays", () => {
  it("reads counted durations and bare words", () => {
    expect(parseDays("1 Day")).toBe(1);
    expect(parseDays("7 days")).toBe(7);
    expect(parseDays("2 Days")).toBe(2);
    expect(parseDays("1 month")).toBe(30);
    expect(parseDays("Weekly")).toBe(7);
    expect(parseDays("Monthly")).toBe(30);
    expect(parseDays("1GB · 30 days")).toBe(30);
  });
  it("returns null when there is no duration", () => {
    expect(parseDays("1GB")).toBeNull();
    expect(parseDays(undefined)).toBeNull();
  });
});

describe("bucketFor / formatting", () => {
  it("buckets by how long the bundle lasts", () => {
    expect(bucketFor(1)).toBe("daily");
    expect(bucketFor(2)).toBe("weekly");
    expect(bucketFor(7)).toBe("weekly");
    expect(bucketFor(30)).toBe("monthly");
    expect(bucketFor(90)).toBe("extended");
    expect(bucketFor(null)).toBe("other");
  });
  it("formats sizes and validity the way a customer reads them", () => {
    expect(formatSize(1024)).toBe("1GB");
    expect(formatSize(1536)).toBe("1.5GB");
    expect(formatSize(250)).toBe("250MB");
    expect(formatValidity(1)).toBe("1 Day");
    expect(formatValidity(30)).toBe("30 Days");
    expect(formatValidity(60)).toBe("2 Months");
    expect(formatValidity(3)).toBe("3 Days");
  });
});

describe("valueDataPlans", () => {
  // Deliberately out of order, the way a provider returns them.
  const plans = [
    plan({ id: "p1", name: "250MB · 1 day", amount: "50", data: "250MB", validity: "1 day" }),
    plan({ id: "p2", name: "1GB · 1 day", amount: "500", data: "1GB", validity: "1 day" }),
    plan({ id: "p3", name: "10GB · 7 days", amount: "2960", data: "10GB", validity: "7 days" }),
    plan({ id: "p4", name: "12GB · 30 days", amount: "4960", data: "12GB", validity: "30 days" }),
    plan({ id: "p5", name: "Mystery pack", amount: "999" }),
  ];

  it("computes naira per gigabyte and sorts best value first", () => {
    const out = valueDataPlans(plans);
    // ₦50 for 250MB is ₦204.80/GB — better value than any of the big bundles.
    expect(out[0].id).toBe("p1");
    expect(out[0].nairaPerGb).toBeCloseTo(204.8, 1);
    expect(out.map((p) => p.nairaPerGb)).toEqual([204.8, 296, 413.33, 500, null]);
    // ₦500 for 1GB is the worst value per GB.
    const worstRankable = out.filter((p) => p.nairaPerGb !== null).at(-1);
    expect(worstRankable!.id).toBe("p2");
  });

  it("marks exactly one best-value plan", () => {
    const out = valueDataPlans(plans);
    expect(out.filter((p) => p.bestValue).map((p) => p.id)).toEqual(["p1"]);
  });

  it("puts an unrankable plan last but still returns it", () => {
    const out = valueDataPlans(plans);
    expect(out.at(-1)!.id).toBe("p5");
    expect(out.at(-1)).toMatchObject({ nairaPerGb: null, bucket: "other", hot: false });
    expect(out).toHaveLength(5);
  });

  it("leads with the best deal from each duration, not just the cheapest per GB", () => {
    // With only 3 hot slots, a naive 'cheapest per GB' pick would take the three
    // long bundles and show nothing for someone who wants data today.
    const out = valueDataPlans(plans, 3);
    const hot = out.filter((p) => p.hot);
    expect(hot).toHaveLength(3);
    // One champion per bucket: daily (p1 beats p2), weekly (p3), monthly (p4).
    expect(new Set(hot.map((p) => p.bucket))).toEqual(
      new Set(["daily", "weekly", "monthly"]),
    );
    expect(hot.map((p) => p.id)).toEqual(["p1", "p3", "p4"]);
    // p2 is the weaker of the two daily plans, so it loses its slot to p1.
    expect(hot.map((p) => p.id)).not.toContain("p2");
    // Still ordered strongest-deal-first.
    expect(hot[0].id).toBe("p1");
  });

  it("falls back to the display name when the provider sends no structured fields", () => {
    const out = valueDataPlans([plan({ id: "m", name: "2GB · 30 days", amount: "1200" })]);
    expect(out[0]).toMatchObject({
      sizeMb: 2048,
      sizeLabel: "2GB",
      days: 30,
      validityLabel: "30 Days",
      bucket: "monthly",
    });
  });
});
