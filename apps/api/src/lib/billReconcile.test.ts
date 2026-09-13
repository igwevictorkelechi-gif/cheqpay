import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  findMany: vi.fn(),
  getAirtimeHistory: vi.fn(),
  settleBillByProviderRef: vi.fn(),
}));

vi.mock("@cheqpay/db", () => ({
  TransactionType: { BILL: "BILL" },
  TransactionStatus: { PROCESSING: "PROCESSING" },
  prisma: { transaction: { findMany: h.findMany } },
}));
vi.mock("./maplerad/airtimeHistory", () => ({ getAirtimeHistory: h.getAirtimeHistory }));
vi.mock("./billSettlement", () => ({ settleBillByProviderRef: h.settleBillByProviderRef }));

import { previewStuckBills, settleStuckBills } from "./billReconcile";

const row = (over: Record<string, unknown> = {}) => ({
  id: "tx-1",
  amount: 10_000n,
  externalRef: "prov-1",
  metadata: { service: "airtime", billerName: "Airtel", customer: "07014998301" },
  createdAt: new Date("2026-09-13T11:31:47Z"),
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  h.findMany.mockResolvedValue([row()]);
  h.getAirtimeHistory.mockResolvedValue([{ id: "prov-1", amount: 10_000 }]);
  h.settleBillByProviderRef.mockResolvedValue({ outcome: "completed", transactionId: "tx-1" });
});

describe("previewStuckBills", () => {
  it("confirms a stuck bill the provider's history lists", async () => {
    const res = await previewStuckBills("user-1");
    expect(res.items[0]).toMatchObject({
      transactionId: "tx-1",
      providerRef: "prov-1",
      confirmedByProvider: true,
      amountMinor: "10000",
    });
    expect(res.summary).toMatchObject({ total: 1, confirmed: 1 });
  });

  it("does not confirm one the history does not list", async () => {
    h.getAirtimeHistory.mockResolvedValue([{ id: "someone-else", amount: 500 }]);
    const res = await previewStuckBills("user-1");
    expect(res.items[0]).toMatchObject({
      confirmedByProvider: false,
      reason: "not in the provider's airtime history",
    });
  });

  it("explains that a non-airtime bill cannot be verified from this history", async () => {
    h.findMany.mockResolvedValue([
      row({ metadata: { service: "data", billerName: "Airtel" } }),
    ]);
    h.getAirtimeHistory.mockResolvedValue([]);
    const res = await previewStuckBills("user-1");
    expect(res.items[0].reason).toContain("only airtime history is available");
  });

  it("flags a bill the provider never accepted", async () => {
    h.findMany.mockResolvedValue([row({ externalRef: null, metadata: { service: "airtime" } })]);
    const res = await previewStuckBills("user-1");
    expect(res.items[0]).toMatchObject({
      providerRef: null,
      confirmedByProvider: false,
      reason: "no provider reference: the purchase was never accepted",
    });
  });

  it("skips the provider call entirely when nothing is stuck", async () => {
    h.findMany.mockResolvedValue([]);
    const res = await previewStuckBills("user-1");
    expect(res.summary).toMatchObject({ total: 0, confirmed: 0 });
    expect(h.getAirtimeHistory).not.toHaveBeenCalled();
  });
});

describe("settleStuckBills", () => {
  it("settles a confirmed bill as successful", async () => {
    const res = await settleStuckBills("user-1");
    expect(h.settleBillByProviderRef).toHaveBeenCalledWith("prov-1", "successful");
    expect(res.summary.settled).toBe(1);
  });

  it("never settles one the provider does not confirm", async () => {
    h.getAirtimeHistory.mockResolvedValue([]);
    const res = await settleStuckBills("user-1");
    expect(h.settleBillByProviderRef).not.toHaveBeenCalled();
    expect(res.summary.settled).toBe(0);
  });

  it("settles only the ids asked for", async () => {
    h.findMany.mockResolvedValue([row(), row({ id: "tx-2", externalRef: "prov-2" })]);
    h.getAirtimeHistory.mockResolvedValue([{ id: "prov-1" }, { id: "prov-2" }]);
    await settleStuckBills("user-1", ["tx-2"]);
    expect(h.settleBillByProviderRef).toHaveBeenCalledTimes(1);
    expect(h.settleBillByProviderRef).toHaveBeenCalledWith("prov-2", "successful");
  });

  it("counts a duplicate as already handled, not newly settled", async () => {
    h.settleBillByProviderRef.mockResolvedValue({ outcome: "duplicate", transactionId: "tx-1" });
    const res = await settleStuckBills("user-1");
    expect(res.summary.settled).toBe(0);
    expect(res.items[0].reason).toBe("already settled");
  });
});
