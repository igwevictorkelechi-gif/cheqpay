import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireAdmin,
  getCustomer,
  getCustomerAccounts,
  hasTier1Evidence,
  storeSnapshot,
  ensureMapleradSchema,
  executeRaw,
} = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  getCustomer: vi.fn(),
  getCustomerAccounts: vi.fn(),
  hasTier1Evidence: vi.fn(),
  storeSnapshot: vi.fn(),
  ensureMapleradSchema: vi.fn(),
  executeRaw: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireAdmin }));
vi.mock("@/lib/maplerad/customers", () => ({ getCustomer, getCustomerAccounts, hasTier1Evidence }));
vi.mock("@/lib/mapleradCustomer", () => ({ ensureMapleradSchema }));
vi.mock("@/lib/mapleradSnapshots", () => ({
  storeMapleradCustomerSnapshot: storeSnapshot,
  redactMapleradCustomer: (d: unknown) => d,
}));
vi.mock("@cheqpay/db", () => ({ prisma: { $executeRaw: executeRaw } }));

import { POST } from "./route";

const customer = {
  id: "cus_1",
  first_name: "Ada",
  identity: { type: "BVN", number: "12345678901" },
};

function call(id = "cus_1") {
  return POST(new Request("https://api/x", { method: "POST" }), {
    params: Promise.resolve({ id }),
  });
}

describe("POST /api/admin/maplerad/customers/[id]/sync", () => {
  beforeEach(() => {
    requireAdmin.mockReset().mockResolvedValue(undefined);
    getCustomer.mockReset().mockResolvedValue(customer);
    getCustomerAccounts.mockReset().mockResolvedValue([{ account_number: "9900000001" }]);
    hasTier1Evidence.mockReset().mockReturnValue(true);
    storeSnapshot.mockReset().mockResolvedValue("snap-1");
    ensureMapleradSchema.mockReset().mockResolvedValue(undefined);
    executeRaw.mockReset().mockResolvedValue(1);
  });

  it("fetches customer + accounts, stores a snapshot, reconciles tier", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(getCustomer).toHaveBeenCalledWith("cus_1");
    expect(getCustomerAccounts).toHaveBeenCalledWith("cus_1");
    expect(storeSnapshot).toHaveBeenCalledWith("cus_1", 1, customer, [
      { account_number: "9900000001" },
    ]);
    expect(body.snapshotId).toBe("snap-1");
    expect(body.tier).toBe(1);
    expect(body.accountsFetched).toBe(1);
    expect(body.linkedUserUpdated).toBe(true);
  });

  it("still snapshots when the accounts call fails", async () => {
    getCustomerAccounts.mockRejectedValue(new Error("boom"));
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.accountsFetched).toBe(0);
    expect(storeSnapshot).toHaveBeenCalledWith("cus_1", 1, customer, []);
  });

  it("requires admin", async () => {
    requireAdmin.mockRejectedValue(new Error("Admin privileges required"));
    const res = await call();
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(getCustomer).not.toHaveBeenCalled();
  });
});
