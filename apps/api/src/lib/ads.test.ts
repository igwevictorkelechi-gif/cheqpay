import { describe, expect, it, vi } from "vitest";

vi.mock("@cheqpay/db", () => ({
  prisma: {},
  Asset: { NGN: "NGN" },
  TransactionStatus: { COMPLETED: "COMPLETED" },
  TransactionType: { AD_PURCHASE: "AD_PURCHASE", AD_REFUND: "AD_REFUND" },
}));
vi.mock("./alerts", () => ({ notifyUser: vi.fn() }));
vi.mock("./adminNotify", () => ({ notifyAdmins: vi.fn() }));
vi.mock("./settingsCache", () => ({ cachedSetting: (_k: string, load: () => unknown) => load(), invalidateSetting: vi.fn() }));

import {
  addDays,
  assertAdImage,
  assertAdLink,
  daypartOf,
  distanceKm,
  lagosDay,
  matchTargeting,
  rankCampaigns,
  relevanceScore,
  roundCoord,
  targetingSchema,
  type UserAdContext,
} from "./ads";

const base: UserAdContext = {
  state: "Lagos",
  city: "Ikeja",
  age: 28,
  createdAt: new Date("2025-01-01T00:00:00Z"),
  segments: ["bill_payers", "crypto_traders"],
  personalised: true,
  mutedCategories: [],
  location: { lat: 6.6, lng: 3.35 },
  platform: "android",
};
const T = (over: object = {}) => targetingSchema.parse(over);
// 14:00 in Lagos (UTC+1) → afternoon
const NOON = new Date("2026-10-07T13:00:00Z");

describe("matchTargeting", () => {
  it("defaults reach any adult, anywhere", () => {
    expect(matchTargeting(T(), "food", base, NOON)).toEqual({ ok: true, why: ["Shown to everyone"] });
    expect(matchTargeting(T(), "food", { ...base, age: 16 }, NOON).ok).toBe(false);
  });

  it("matches state, ignoring 'State' suffix and case", () => {
    expect(matchTargeting(T({ states: ["Lagos"] }), "food", { ...base, state: "lagos state" }, NOON)).toMatchObject({ ok: true, why: ["lagos state"] });
    expect(matchTargeting(T({ states: ["FCT"] }), "food", { ...base, state: "Abuja" }, NOON).ok).toBe(true);
    expect(matchTargeting(T({ states: ["Ogun"] }), "food", base, NOON).ok).toBe(false);
    expect(matchTargeting(T({ states: ["Lagos"] }), "food", { ...base, state: null }, NOON).ok).toBe(false);
  });

  it("keeps adult categories away from minors and people of unknown age", () => {
    const t = T({ ageMin: 13 });
    expect(matchTargeting(t, "betting", { ...base, age: 17 }, NOON).ok).toBe(false);
    expect(matchTargeting(t, "betting", { ...base, age: null }, NOON).ok).toBe(false);
    expect(matchTargeting(t, "betting", { ...base, age: 18 }, NOON).ok).toBe(true);
    expect(matchTargeting(t, "food", { ...base, age: null }, NOON).ok).toBe(true);
  });

  it("filters by age band, platform and time of day", () => {
    expect(matchTargeting(T({ ageMin: 30, ageMax: 40 }), "food", base, NOON).ok).toBe(false);
    expect(matchTargeting(T({ ageMin: 25, ageMax: 30 }), "food", base, NOON)).toMatchObject({ ok: true, why: ["Aged 25–30"] });
    expect(matchTargeting(T({ platforms: ["ios"] }), "food", base, NOON).ok).toBe(false);
    expect(matchTargeting(T({ platforms: ["ios"] }), "food", { ...base, platform: null }, NOON).ok).toBe(false);
    expect(matchTargeting(T({ dayparts: ["afternoon"] }), "food", base, NOON).ok).toBe(true);
    expect(matchTargeting(T({ dayparts: ["morning", "night"] }), "food", base, NOON).ok).toBe(false);
  });

  it("filters by distance from a point", () => {
    const near = T({ radius: { lat: 6.6, lng: 3.4, km: 10 } });
    expect(matchTargeting(near, "food", base, NOON)).toMatchObject({ ok: true, why: ["Near you (within 10 km)"] });
    expect(matchTargeting(T({ radius: { lat: 9.07, lng: 7.4, km: 20 } }), "food", base, NOON).ok).toBe(false);
    expect(matchTargeting(near, "food", { ...base, location: null }, NOON).ok).toBe(false);
  });

  it("filters by activity segments and says which matched", () => {
    expect(matchTargeting(T({ segments: ["card_users", "crypto_traders"] }), "food", base, NOON)).toMatchObject({
      ok: true,
      why: ["Buy or sell crypto"],
    });
    expect(matchTargeting(T({ segments: ["gadget_buyers"] }), "food", base, NOON).ok).toBe(false);
  });

  it("new-users-only matches accounts under 30 days old", () => {
    const fresh = { ...base, createdAt: new Date(NOON.getTime() - 5 * 86_400_000) };
    expect(matchTargeting(T({ newUsersOnly: true }), "food", fresh, NOON).ok).toBe(true);
    expect(matchTargeting(T({ newUsersOnly: true }), "food", base, NOON).ok).toBe(false);
  });

  it("with personalised ads off, only state/age/platform apply", () => {
    const off = { ...base, personalised: false };
    expect(matchTargeting(T({ states: ["Lagos"] }), "food", off, NOON).ok).toBe(true);
    expect(matchTargeting(T({ segments: ["bill_payers"] }), "food", off, NOON).ok).toBe(false);
    expect(matchTargeting(T({ radius: { lat: 6.6, lng: 3.35, km: 50 } }), "food", off, NOON).ok).toBe(false);
    expect(matchTargeting(T({ newUsersOnly: true }), "food", { ...off, createdAt: NOON }, NOON).ok).toBe(false);
  });

  it("never shows a muted category", () => {
    expect(matchTargeting(T(), "food", { ...base, mutedCategories: ["food"] }, NOON).ok).toBe(false);
  });
});

describe("ranking", () => {
  it("prefers more relevant campaigns, and paces busy ones down", () => {
    const ctx = base;
    const targeted = relevanceScore(T({ segments: ["bill_payers", "crypto_traders"] }), ctx);
    const broad = relevanceScore(T(), ctx);
    expect(targeted).toBeGreaterThan(broad);
    const ranked = rankCampaigns([
      { id: "a", relevance: broad, viewsToday: 0 },
      { id: "b", relevance: targeted, viewsToday: 0 },
    ]);
    expect(ranked[0].id).toBe("b");
    // A campaign far ahead on views today yields to one that's behind.
    const paced = rankCampaigns([
      { id: "busy", relevance: targeted, viewsToday: 500 },
      { id: "quiet", relevance: broad, viewsToday: 0 },
    ]);
    expect(paced[0].id).toBe("quiet");
  });

  it("nearer is more relevant", () => {
    const t = T({ radius: { lat: 6.6, lng: 3.35, km: 20 } });
    expect(relevanceScore(t, base)).toBeGreaterThan(relevanceScore(t, { ...base, location: { lat: 6.7, lng: 3.45 } }));
  });
});

describe("helpers", () => {
  it("dates and dayparts in Lagos time", () => {
    expect(lagosDay(new Date("2026-10-07T23:30:00Z"))).toBe("2026-10-08");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect([5, 6, 12, 17, 22].map(daypartOf)).toEqual(["night", "morning", "afternoon", "evening", "night"]);
  });

  it("rounds locations to about 5 km and measures distance", () => {
    expect(roundCoord(6.5244)).toBe(6.5);
    expect(roundCoord(3.3792)).toBe(3.4);
    expect(distanceKm({ lat: 6.5244, lng: 3.3792 }, { lat: 9.0765, lng: 7.3986 })).toBeGreaterThan(500);
  });

  it("accepts only real PNG/JPEG/WebP images", () => {
    const png = `data:image/png;base64,${Buffer.from("89504e470d0a1a0a0000000d", "hex").toString("base64")}`;
    expect(() => assertAdImage(png)).not.toThrow();
    const fake = `data:image/png;base64,${Buffer.from("<html><script>").toString("base64")}`;
    expect(() => assertAdImage(fake)).toThrow(/real image/);
    expect(() => assertAdImage("data:image/svg+xml;base64,PHN2Zz4=")).toThrow(/PNG, JPEG or WebP/);
  });

  it("links must be https", () => {
    expect(() => assertAdLink("https://shop.example.com/x")).not.toThrow();
    expect(() => assertAdLink(null)).not.toThrow();
    expect(() => assertAdLink("http://shop.example.com")).toThrow();
    expect(() => assertAdLink("javascript:alert(1)")).toThrow();
  });
});
