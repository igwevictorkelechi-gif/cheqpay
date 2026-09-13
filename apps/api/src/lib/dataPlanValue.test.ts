import { describe, expect, it } from "vitest";
import type { BillPlan } from "./bills";
import {
  bucketFor,
  isNightPlan,
  parseBonus,
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

describe("isNightPlan", () => {
  it("spots the provider's night wording", () => {
    expect(isNightPlan("500MB Night Plan")).toBe(true);
    expect(isNightPlan("2GB midnight bundle")).toBe(true);
    expect(isNightPlan("1GB off-peak")).toBe(true);
    expect(isNightPlan("1GB · 30 days")).toBe(false);
    expect(isNightPlan(null)).toBe(false);
  });

  it("is a flag, not a bucket — a night plan keeps its duration tab", () => {
    const out = valueDataPlans([
      plan({ id: "n", name: "500MB Night Plan · 1 day", amount: "100" }),
    ]);
    expect(out[0]).toMatchObject({ night: true, bucket: "daily" });
  });
});

describe("parseBonus", () => {
  it("reads a + segment and stops at a separator", () => {
    expect(parseBonus("6GB + 2GB YouTube · 2 days")).toBe("2GB YouTube");
    expect(parseBonus("12GB + 100 mins")).toBe("100 mins");
  });
  it("returns null when the name promises nothing extra", () => {
    expect(parseBonus("1GB · 30 days")).toBeNull();
    expect(parseBonus(null)).toBeNull();
  });
});

/**
 * Fixtures copied verbatim from Maplerad's "Get Available Bundles" response, so
 * this locks our reading of the real contract rather than an assumed one.
 */
describe("against Maplerad's documented bundle shape", () => {
  const doc = (data: string, validity: string, price: number, code: string) =>
    plan({ id: code, name: `${data} - ${validity}`, amount: String(price / 100), data, validity });

  it("reads volume, price and validity for every documented bundle", () => {
    const out = valueDataPlans([
      doc("100MB Daily for Daily", "Daily", 10_000, "100_9"),
      doc("1.5GB for Monthly", "Monthly", 100_000, "1000_9"),
      doc("120GB for 60Days", "60Days", 3_000_000, "30000_9"),
      doc("400GB for 1Year", "1Year", 12_000_000, "120000_9"),
    ]);
    const by = Object.fromEntries(out.map((p) => [p.id, p]));
    expect(by["100_9"]).toMatchObject({ sizeLabel: "100MB", validityLabel: "1 Day", bucket: "daily" });
    expect(by["1000_9"]).toMatchObject({ sizeLabel: "1.5GB", validityLabel: "30 Days", bucket: "monthly" });
    expect(by["30000_9"]).toMatchObject({ sizeLabel: "120GB", validityLabel: "2 Months", bucket: "extended" });
    expect(by["120000_9"]).toMatchObject({ sizeLabel: "400GB", validityLabel: "1 Year", bucket: "extended" });
  });

  it("trusts the stated duration over the coarse validity category", () => {
    // Maplerad ships these with validity "Daily" / "Weekly" even though they
    // run 3 and 14 days. Believing the category misstates the validity to the
    // customer and files the plan under the wrong tab.
    const out = valueDataPlans([
      doc("200MB 3Day Plan for Daily", "Daily", 20_000, "200_9"),
      doc("750MB 2Week Plan for Weekly", "Weekly", 50_000, "500_9"),
    ]);
    const by = Object.fromEntries(out.map((p) => [p.id, p]));
    expect(by["200_9"]).toMatchObject({ days: 3, validityLabel: "3 Days", bucket: "weekly" });
    expect(by["500_9"]).toMatchObject({ days: 14, validityLabel: "14 Days", bucket: "monthly" });
  });

  it("prices in kobo round-trip to the naira the customer is charged", () => {
    // price 350000 kobo -> "3500" naira on the plan -> ₦3,500.
    const out = valueDataPlans([doc("12GB for Monthly", "Monthly", 350_000, "3500_9")]);
    expect(out[0].amount).toBe("3500");
    expect(out[0].nairaPerGb).toBeCloseTo(291.67, 1);
  });
});
