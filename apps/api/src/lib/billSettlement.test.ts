import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  findFirst: vi.fn(),
  updateMany: vi.fn(),
  balanceUpdate: vi.fn(),
  txn: vi.fn(),
  awardCashback: vi.fn(),
  notifyUser: vi.fn(),
}));

vi.mock("@cheqpay/db", () => ({
  Asset: { NGN: "NGN" },
  TransactionType: { BILL: "BILL" },
  TransactionStatus: { PROCESSING: "PROCESSING", COMPLETED: "COMPLETED", FAILED: "FAILED" },
  prisma: {
    transaction: { findFirst: h.findFirst, updateMany: h.updateMany },
    balance: { update: h.balanceUpdate },
    // The failure path runs inside an interactive transaction.
    $transaction: (fn: (db: unknown) => unknown) =>
      h.txn(fn) ??
      fn({
        transaction: { updateMany: h.updateMany },
        balance: { update: h.balanceUpdate },
      }),
  },
}));
vi.mock("./cashback", () => ({ awardCashback: h.awardCashback }));
vi.mock("./alerts", () => ({ notifyUser: h.notifyUser }));

import { billOutcomeFrom, settleBillByProviderRef } from "./billSettlement";

const row = {
  id: "tx-1",
  userId: "user-1",
  amount: 10_000n,
  fee: 500n,
  status: "PROCESSING",
  metadata: { billerName: "Airtel" },
};

beforeEach(() => {
  vi.clearAllMocks();
  h.txn.mockReturnValue(undefined); // fall through to the real callback
  h.findFirst.mockResolvedValue(row);
  h.updateMany.mockResolvedValue({ count: 1 });
  h.balanceUpdate.mockResolvedValue({});
  h.awardCashback.mockResolvedValue(0n);
  h.notifyUser.mockResolvedValue({ devices: 0, email: false });
});

describe("billOutcomeFrom", () => {
  it("reads the event name, then the status", () => {
    expect(billOutcomeFrom("bill.successful")).toBe("successful");
    expect(billOutcomeFrom("bill.failed")).toBe("failed");
    expect(billOutcomeFrom("bill.updated", "SUCCESS")).toBe("successful");
    expect(billOutcomeFrom("bill.updated", "DECLINED")).toBe("failed");
    expect(billOutcomeFrom("bill.updated", "PENDING")).toBe("pending");
    expect(billOutcomeFrom("bill.updated")).toBe("pending");
  });
});

describe("settleBillByProviderRef", () => {
  it("completes a successful bill and pays cashback on the face value", async () => {
    const res = await settleBillByProviderRef("ref-1", "successful");
    expect(res).toMatchObject({ outcome: "completed", transactionId: "tx-1" });
    expect(h.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "tx-1", status: "PROCESSING" },
        data: { status: "COMPLETED" },
      }),
    );
    // Face value, not the margin-inclusive total.
    expect(h.awardCashback).toHaveBeenCalledWith(
      expect.objectContaining({ baseNgnMinor: 10_000n, source: "bill" }),
    );
    expect(h.balanceUpdate).not.toHaveBeenCalled();
  });

  it("refunds the amount AND the margin on a failed bill", async () => {
    const res = await settleBillByProviderRef("ref-1", "failed");
    expect(res).toMatchObject({ outcome: "refunded", transactionId: "tx-1" });
    expect(h.balanceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { available: { increment: 10_500n } } }),
    );
    expect(h.awardCashback).not.toHaveBeenCalled();
  });

  it("is idempotent: a second delivery settles nothing twice", async () => {
    h.updateMany.mockResolvedValue({ count: 0 }); // another delivery already won
    const res = await settleBillByProviderRef("ref-1", "successful");
    expect(res.outcome).toBe("duplicate");
    expect(h.awardCashback).not.toHaveBeenCalled();
    expect(h.balanceUpdate).not.toHaveBeenCalled();
  });

  it("does not re-settle a row that is already finished", async () => {
    h.findFirst.mockResolvedValue({ ...row, status: "COMPLETED" });
    const res = await settleBillByProviderRef("ref-1", "failed");
    expect(res.outcome).toBe("duplicate");
    expect(h.updateMany).not.toHaveBeenCalled();
    expect(h.balanceUpdate).not.toHaveBeenCalled();
  });

  it("reports an unplaceable reference rather than guessing", async () => {
    h.findFirst.mockResolvedValue(null);
    expect(await settleBillByProviderRef("nope", "successful")).toMatchObject({
      outcome: "unmatched",
    });
  });

  it("ignores a pending event and an empty reference without touching money", async () => {
    expect((await settleBillByProviderRef("ref-1", "pending")).outcome).toBe("ignored");
    expect((await settleBillByProviderRef("", "successful")).outcome).toBe("ignored");
    expect(h.findFirst).not.toHaveBeenCalled();
    expect(h.balanceUpdate).not.toHaveBeenCalled();
  });
});
