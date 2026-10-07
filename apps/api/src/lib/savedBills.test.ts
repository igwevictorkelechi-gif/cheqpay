import { describe, expect, it, vi } from "vitest";

vi.mock("@cheqpay/db", () => ({ prisma: {}, Asset: { NGN: "NGN" }, TransactionStatus: {}, TransactionType: {} }));
vi.mock("./alerts", () => ({ notifyUser: vi.fn() }));
vi.mock("./billCatalog", () => ({ getBillCatalog: vi.fn(async () => []) }));
vi.mock("./billPay", () => ({ executeBillPayment: vi.fn() }));
vi.mock("./features", () => ({ getFeatureFlags: vi.fn(async () => ({ bill_payments: true })) }));

import { describeSavedBill, lagosDate, lagosMonth, monthRange, ordinal } from "./savedBills";

const now = new Date("2026-10-20T09:00:00Z");
const ctx = (over: object = {}) => ({ billerName: "DStv", serviceLabel: "Cable TV", planName: "Compact", expectedMinor: 1_570_000n, lastPaid: null, paidInMonth: null, now, ...over });
const txn = (daysAgo: number, amount = 1_570_000n) => ({ service: "cabletv", customer: "7032118890", amount, createdAt: new Date(now.getTime() - daysAgo * 86_400_000) });

describe("describeSavedBill", () => {
  it("cable TV counts down to renewal from the last payment", () => {
    expect(describeSavedBill({ service: "cabletv", autopay: false, autopay_day: null, autopay_note: null }, ctx({ lastPaid: txn(27) }))).toEqual({
      state: "due", detail: "DStv Compact ₦15,700, due in 3 days", dueInDays: 3,
    });
    expect(describeSavedBill({ service: "cabletv", autopay: false, autopay_day: null, autopay_note: null }, ctx({ lastPaid: txn(33) })).detail).toBe("DStv Compact ₦15,700, overdue by 3 days");
    expect(describeSavedBill({ service: "cabletv", autopay: false, autopay_day: null, autopay_note: null }, ctx()).detail).toBe("DStv Compact ₦15,700, due now");
  });

  it("autopay shows the day and its state", () => {
    const r = { service: "airtime", autopay: true, autopay_day: 10, autopay_note: null };
    expect(describeSavedBill(r, ctx({ billerName: "Glo", serviceLabel: "Airtime", planName: null, expectedMinor: 200_000n })).detail).toBe("Glo airtime ₦2,000 on the 10th. Autopay is on");
    expect(describeSavedBill({ ...r, autopay_note: "Last autopay skipped: low balance" }, ctx({ billerName: "Glo", serviceLabel: "Airtime", planName: null, expectedMinor: 200_000n })).detail).toBe(
      "Glo airtime ₦2,000 on the 10th. Last autopay skipped: low balance",
    );
  });

  it("prepaid power shows when it was last topped up", () => {
    const r = { service: "electricity", autopay: false, autopay_day: null, autopay_note: null };
    expect(describeSavedBill(r, ctx({ billerName: "IKEDC", serviceLabel: "Electricity", planName: null, lastPaid: txn(12) }))).toMatchObject({ state: "topup", detail: "IKEDC prepaid, last topped up 12 days ago" });
  });

  it("anything paid this month reads as paid", () => {
    const r = { service: "cabletv", autopay: true, autopay_day: 5, autopay_note: null };
    expect(describeSavedBill(r, ctx({ paidInMonth: txn(2) }))).toMatchObject({ state: "paid", detail: "Paid ₦15,700 on 18 Oct" });
  });
});

describe("Lagos calendar", () => {
  it("month boundaries are Lagos midnight", () => {
    const [a, b] = monthRange("2026-10");
    expect(a.toISOString()).toBe("2026-09-30T23:00:00.000Z");
    expect(b.toISOString()).toBe("2026-10-31T23:00:00.000Z");
    expect(lagosMonth(new Date("2026-10-31T23:30:00Z"))).toBe("2026-11");
    expect(lagosDate(new Date("2026-10-09T23:30:00Z"))).toBe("2026-10-10");
  });
  it("ordinals", () => {
    expect([1, 2, 3, 4, 10, 11, 12, 13, 21, 22, 28].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "10th", "11th", "12th", "13th", "21st", "22nd", "28th"]);
  });
});
