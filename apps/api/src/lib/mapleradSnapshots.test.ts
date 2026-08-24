import { beforeEach, describe, expect, it, vi } from "vitest";

const { executeRaw, queryRaw, executeRawUnsafe } = vi.hoisted(() => ({
  executeRaw: vi.fn(),
  queryRaw: vi.fn(),
  executeRawUnsafe: vi.fn(),
}));

vi.mock("@cheqpay/db", () => ({
  prisma: { $executeRaw: executeRaw, $queryRaw: queryRaw, $executeRawUnsafe: executeRawUnsafe },
}));

import {
  redactMapleradCustomer,
  storeMapleradCustomerSnapshot,
} from "./mapleradSnapshots";
import type { MapleradCustomerDetail } from "./maplerad/types";

const detail: MapleradCustomerDetail = {
  id: "cus_1",
  first_name: "Ada",
  last_name: "Obi",
  email: "ada@example.com",
  phone_number: "8031234567",
  dob: "14-02-2000",
  identity: { type: "BVN", number: "12345678901", image: "https://x/img.jpg", country: "NG" },
  address: { street: "1 Rd", city: "Ikoyi", state: "Lagos", postal_code: "101233", country: "NG" },
  status: "COMPLETED",
};

describe("maplerad customer snapshots", () => {
  beforeEach(() => {
    executeRaw.mockReset().mockResolvedValue(1);
    executeRawUnsafe.mockReset().mockResolvedValue(0);
  });

  it("redacts the ID number and image, keeping everything else", () => {
    const r = redactMapleradCustomer(detail);
    expect(r.identity).not.toHaveProperty("number");
    expect(r.identity).not.toHaveProperty("image");
    expect(r.identity?.type).toBe("BVN");
    expect(r.phone_number).toBe("8031234567");
    expect(r.address?.city).toBe("Ikoyi");
  });

  it("stores a combined { customer, accounts } payload with the ID number stripped", async () => {
    await storeMapleradCustomerSnapshot("cus_1", 1, detail, [{ account_number: "9900000001" }]);
    const values = executeRaw.mock.calls[0].slice(1);
    // customer_id, tier, and the jsonb payload string are all bound.
    expect(values).toContain("cus_1");
    expect(values).toContain(1);
    const payloadStr = values.find((v: unknown) => typeof v === "string" && v.includes("customer"));
    expect(payloadStr).toBeTruthy();
    const parsed = JSON.parse(payloadStr as string);
    expect(parsed.customer.identity.number).toBeUndefined();
    expect(parsed.customer.identity.image).toBeUndefined();
    expect(parsed.accounts).toEqual([{ account_number: "9900000001" }]);
    // The bytes never carry the raw BVN.
    expect(payloadStr).not.toContain("12345678901");
  });
});
