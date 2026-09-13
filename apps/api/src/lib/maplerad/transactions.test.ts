import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ mapleradRequest: vi.fn() }));
vi.mock("./client", () => ({ mapleradRequest: h.mapleradRequest }));

import { getCustomerTransactions, verifyTransaction } from "./transactions";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getCustomerTransactions", () => {
  it("reads the live shape: data.{deposit,withdrawal}", async () => {
    h.mapleradRequest.mockResolvedValue({
      deposit: [{ transaction_id: "d1", amount: 0 }],
      withdrawal: [{ transaction_id: "w1" }],
    });
    const res = await getCustomerTransactions("cust-1");
    expect(h.mapleradRequest).toHaveBeenCalledWith("/customers/cust-1/transactions");
    expect(res.deposit).toEqual([{ transaction_id: "d1", amount: 0 }]);
    expect(res.withdrawal).toHaveLength(1);
  });

  it("tolerates a legacy flat array by reading deposit-shaped rows", async () => {
    h.mapleradRequest.mockResolvedValue([
      { transaction_id: "d1" },
      { nope: true },
    ]);
    const res = await getCustomerTransactions("c");
    expect(res.deposit).toEqual([{ transaction_id: "d1" }]);
    expect(res.withdrawal).toEqual([]);
  });

  it("url-encodes the customer id and returns empty lists for a null body", async () => {
    h.mapleradRequest.mockResolvedValue(null);
    const res = await getCustomerTransactions("a/b");
    expect(h.mapleradRequest).toHaveBeenCalledWith("/customers/a%2Fb/transactions");
    expect(res).toEqual({ deposit: [], withdrawal: [] });
  });
});

describe("verifyTransaction", () => {
  it("calls the verify path and returns the detail", async () => {
    h.mapleradRequest.mockResolvedValue({
      id: "t1",
      status: "SUCCESS",
      entry: "CREDIT",
      type: "COLLECTION",
      amount: 100000000,
      fee: 75000,
      currency: "NGN",
    });
    const tx = await verifyTransaction("t1");
    expect(h.mapleradRequest).toHaveBeenCalledWith("/transactions/verify/t1");
    expect(tx).toMatchObject({ id: "t1", amount: 100000000, currency: "NGN" });
  });
});
