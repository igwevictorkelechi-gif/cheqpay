import { describe, expect, it } from "vitest";
import { BillPaymentError } from "@/payments/types";
import { billFee, isDefiniteBillRefusal, normaliseBillCustomer, sandboxOutcome } from "./bills";

describe("bill fee", () => {
  it("is basis points of the amount, capped, with 0 meaning no cap", () => {
    expect(billFee({ billFeeBps: 100, billFeeCapMinor: 10_000 }, 50_000n)).toBe(500n);
    expect(billFee({ billFeeBps: 100, billFeeCapMinor: 10_000 }, 5_000_000n)).toBe(10_000n);
    expect(billFee({ billFeeBps: 25, billFeeCapMinor: 0 }, 5_000_000n)).toBe(12_500n);
    expect(billFee({ billFeeBps: 0, billFeeCapMinor: 0 }, 5_000_000n)).toBe(0n);
  });
});

describe("customer numbers", () => {
  it("takes Nigerian phone numbers in any common form for airtime and data", () => {
    for (const raw of ["08031234567", "+2348031234567", "234 803 123 4567", "0803-123-4567", "(0803) 123 4567"]) {
      expect(normaliseBillCustomer("airtime", raw)).toBe("08031234567");
    }
    expect(normaliseBillCustomer("data", "09121234567")).toBe("09121234567");
    for (const bad of ["0803123456", "12345678901", "0603123456", "08031234567x", "+1 415 555 0100"]) {
      expect(normaliseBillCustomer("airtime", bad)).toBeNull();
    }
  });

  it("takes digits only for meters and smartcards", () => {
    expect(normaliseBillCustomer("electricity", "4516 0826-181")).toBe("45160826181");
    expect(normaliseBillCustomer("cabletv", "7023456789")).toBe("7023456789");
    expect(normaliseBillCustomer("electricity", "12345")).toBeNull();
    expect(normaliseBillCustomer("cabletv", "ABC123456")).toBeNull();
  });

  it("decides sandbox outcomes from the last digits", () => {
    expect(sandboxOutcome("08030000000")).toBe("failed");
    expect(sandboxOutcome("08031111111")).toBe("pending");
    expect(sandboxOutcome("08031234567")).toBe("successful");
  });
});

describe("refusal or unknown", () => {
  it("refunds only when the provider said no or the request was never sent", () => {
    expect(isDefiniteBillRefusal(new BillPaymentError("refused", "Insufficient balance", 400))).toBe(true);
    expect(isDefiniteBillRefusal(new BillPaymentError("not sent", "Pick a data plan."))).toBe(true);
    expect(isDefiniteBillRefusal(new BillPaymentError("upstream", "Bad gateway", 502))).toBe(false);
    expect(isDefiniteBillRefusal(new Error("The operation was aborted due to timeout"))).toBe(false);
    expect(isDefiniteBillRefusal({ status: 400 })).toBe(false);
  });
});
