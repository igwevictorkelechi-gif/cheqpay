import { describe, expect, it } from "vitest";
import { serializeTransaction } from "./txn";

const base = {
  id: "t1", userId: "u1", type: "BILL", asset: "NGN", network: null, amount: 100000n, fee: 0n, status: "COMPLETED",
  txHash: null, createdAt: new Date("2026-10-01T10:00:00Z"), updatedAt: new Date("2026-10-01T10:00:00Z"),
  externalRef: null, idempotencyKey: "k1",
};

describe("serializeTransaction", () => {
  it("exposes the bill's biller and plan ids so 'Pay again' can prefill the flow", () => {
    const t = serializeTransaction({
      ...base,
      metadata: { kind: "bill", service: "data", billerId: "mtn", billerName: "MTN", customer: "08031234567", planId: "mtn-1gb", planName: "1GB · 30 days" },
    } as never);
    expect(t).toMatchObject({ service: "data", billerId: "mtn", billerName: "MTN", planId: "mtn-1gb", planName: "1GB · 30 days", customer: "08031234567", amountFormatted: expect.any(String) });
  });

  it("returns nulls for older payments without the ids", () => {
    const t = serializeTransaction({ ...base, metadata: { kind: "bill", service: "airtime", billerName: "Airtel", customer: "0701" } } as never);
    expect(t.billerId).toBeNull();
    expect(t.planId).toBeNull();
  });
});
