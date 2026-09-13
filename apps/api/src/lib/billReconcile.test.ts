import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  findMany: vi.fn(),
  verifyTransaction: vi.fn(),
  settleBillByProviderRef: vi.fn(),
}));

vi.mock("@cheqpay/db", () => ({
  TransactionType: { BILL: "BILL" },
  TransactionStatus: { PROCESSING: "PROCESSING" },
  prisma: { transaction: { findMany: h.findMany } },
}));
vi.mock("./maplerad/transactions", () => ({ verifyTransaction: h.verifyTransaction }));
vi.mock("./mapleradCustomer", () => ({
  describeProviderError: (e: unknown) => (e as Error).message,
}));
vi.mock("./billSettlement", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, settleBillByProviderRef: h.settleBillByProviderRef };
});

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
  h.verifyTransaction.mockResolvedValue({ id: "prov-1", status: "SUCCESS" });
  h.settleBillByProviderRef.mockResolvedValue({ outcome: "completed", transactionId: "tx-1" });
});

describe("previewStuckBills", () => {
  it("asks the provider about the bill by its own id", async () => {
    const res = await previewStuckBills("user-1");
    expect(h.verifyTransaction).toHaveBeenCalledWith("prov-1");
    expect(res.items[0]).toMatchObject({
      transactionId: "tx-1",
      providerStatus: "SUCCESS",
      resolution: "complete",
      amountMinor: "10000",
    });
    expect(res.summary).toMatchObject({ total: 1, resolvable: 1 });
  });

  it("marks a provider-reported failure for refund", async () => {
    h.verifyTransaction.mockResolvedValue({ id: "prov-1", status: "FAILED" });
    const res = await previewStuckBills("user-1");
    expect(res.items[0]).toMatchObject({ providerStatus: "FAILED", resolution: "refund" });
  });

  it("leaves a still-pending bill alone — no answer yet is not an outcome", async () => {
    h.verifyTransaction.mockResolvedValue({ id: "prov-1", status: "PENDING" });
    const res = await previewStuckBills("user-1");
    expect(res.items[0]).toMatchObject({
      resolution: null,
      reason: "the provider still reports it pending",
    });
    expect(res.summary.resolvable).toBe(0);
  });

  it("one unanswerable bill does not hide the others", async () => {
    h.findMany.mockResolvedValue([row(), row({ id: "tx-2", externalRef: "prov-2" })]);
    h.verifyTransaction.mockImplementation(async (ref: string) => {
      if (ref === "prov-1") throw new Error("provider exploded");
      return { id: ref, status: "SUCCESS" };
    });
    const res = await previewStuckBills("user-1");
    const byId = Object.fromEntries(res.items.map((i) => [i.transactionId, i]));
    expect(byId["tx-1"]).toMatchObject({ resolution: null, reason: "provider exploded" });
    expect(byId["tx-2"]).toMatchObject({ resolution: "complete" });
  });

  it("flags a bill the provider never accepted, without calling out", async () => {
    h.findMany.mockResolvedValue([row({ externalRef: null, metadata: { service: "airtime" } })]);
    const res = await previewStuckBills("user-1");
    expect(res.items[0]).toMatchObject({
      providerRef: null,
      resolution: null,
      reason: "no provider reference: the purchase was never accepted",
    });
    expect(h.verifyTransaction).not.toHaveBeenCalled();
  });
});

describe("settleStuckBills", () => {
  it("completes a bill the provider reports successful", async () => {
    const res = await settleStuckBills("user-1");
    expect(h.settleBillByProviderRef).toHaveBeenCalledWith("prov-1", "successful");
    expect(res.summary.settled).toBe(1);
  });

  it("refunds a bill the provider reports failed", async () => {
    h.verifyTransaction.mockResolvedValue({ id: "prov-1", status: "FAILED" });
    h.settleBillByProviderRef.mockResolvedValue({ outcome: "refunded", transactionId: "tx-1" });
    const res = await settleStuckBills("user-1");
    expect(h.settleBillByProviderRef).toHaveBeenCalledWith("prov-1", "failed");
    expect(res.summary.settled).toBe(1);
    expect(res.items[0].reason).toBe("refunded just now");
  });

  it("never settles one the provider still calls pending", async () => {
    h.verifyTransaction.mockResolvedValue({ id: "prov-1", status: "PENDING" });
    const res = await settleStuckBills("user-1");
    expect(h.settleBillByProviderRef).not.toHaveBeenCalled();
    expect(res.summary.settled).toBe(0);
  });

  it("settles only the ids asked for", async () => {
    h.findMany.mockResolvedValue([row(), row({ id: "tx-2", externalRef: "prov-2" })]);
    h.verifyTransaction.mockImplementation(async (ref: string) => ({ id: ref, status: "SUCCESS" }));
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
