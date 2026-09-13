import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ mapleradRequest: vi.fn() }));
vi.mock("./client", () => ({ mapleradRequest: h.mapleradRequest }));

import { getCustomerTransactions } from "./transactions";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getCustomerTransactions", () => {
  it("calls the customer transactions path and returns the rows", async () => {
    h.mapleradRequest.mockResolvedValue([{ id: "t1", entry: "CREDIT" }]);
    const rows = await getCustomerTransactions("cust-1");
    expect(h.mapleradRequest).toHaveBeenCalledWith("/customers/cust-1/transactions");
    expect(rows).toEqual([{ id: "t1", entry: "CREDIT" }]);
  });

  it("url-encodes the customer id", async () => {
    h.mapleradRequest.mockResolvedValue([]);
    await getCustomerTransactions("a/b?c");
    expect(h.mapleradRequest).toHaveBeenCalledWith("/customers/a%2Fb%3Fc/transactions");
  });

  it("returns an empty array when the provider sends null or a non-array", async () => {
    h.mapleradRequest.mockResolvedValue(null);
    expect(await getCustomerTransactions("c")).toEqual([]);
    h.mapleradRequest.mockResolvedValue({ not: "an array" });
    expect(await getCustomerTransactions("c")).toEqual([]);
  });
});
