import { describe, expect, it, vi } from "vitest";

vi.mock("@cheqpay/db", () => ({ prisma: {}, Asset: { NGN: "NGN" }, TransactionStatus: {}, TransactionType: {} }));
vi.mock("./alerts", () => ({ notifyUser: vi.fn() }));
vi.mock("./settings", () => ({ getUsdtNgnRate: vi.fn() }));

import { commissionKobo, normalizeCode, revenueKobo, shareLink, toNgnKobo } from "./referrals";

describe("referral maths", () => {
  it("normalises codes: letters and digits, 4–16, upper-case", () => {
    expect(normalizeCode(" tolu-10 ")).toBe("TOLU10");
    expect(normalizeCode("ab")).toBeNull();
    expect(normalizeCode("a".repeat(17))).toBeNull();
  });

  it("converts fees to kobo at the business dollar rate", () => {
    expect(toNgnKobo("NGN", 7_500n, 1500)).toBe(7_500n);
    expect(toNgnKobo("USD", 100n, 1500)).toBe(150_000n); // $1.00 = ₦1,500
    expect(toNgnKobo("USDT", 1_000_000n, 1500)).toBe(150_000n); // 1 USDT (6 dp)
    expect(toNgnKobo("USD", 100n, null)).toBe(0n); // no rate → nothing, never a guess
    expect(toNgnKobo("BTC", 1000n, 1500)).toBe(0n);
  });

  it("counts both the recorded fee and a convert's spread as revenue", () => {
    expect(revenueKobo({ asset: "NGN", fee: 5_000n, spread_minor: null, spread_asset: null }, 1500)).toBe(5_000n);
    expect(revenueKobo({ asset: "USD", fee: 0n, spread_minor: "500", spread_asset: "NGN" }, 1500)).toBe(500n);
    expect(revenueKobo({ asset: "NGN", fee: 0n, spread_minor: "2", spread_asset: "USD" }, 1500)).toBe(3_000n);
    expect(revenueKobo({ asset: "NGN", fee: 0n, spread_minor: "-5", spread_asset: "NGN" }, 1500)).toBe(0n);
  });

  it("takes the influencer's share in basis points, rounding down", () => {
    expect(commissionKobo(13_000n, 2_000)).toBe(2_600n);
    expect(commissionKobo(99n, 1_500)).toBe(14n);
  });

  it("points influencer links at the tracking portal and basic links at sign-up", () => {
    expect(shareLink({ code: "TOLU10", kind: "INFLUENCER" })).toBe("https://creator.mycheqpay.com/r/TOLU10");
    expect(shareLink({ code: "ADA123", kind: "BASIC" })).toBe("https://mycheqpay.com/signup/?ref=ADA123");
  });
});
