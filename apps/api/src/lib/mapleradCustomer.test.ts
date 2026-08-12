import { beforeEach, describe, expect, it, vi } from "vitest";

const { createCustomer, upgradeCustomerTier1, findUnique, update, executeRawUnsafe } = vi.hoisted(
  () => ({
    createCustomer: vi.fn(),
    upgradeCustomerTier1: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    executeRawUnsafe: vi.fn(),
  })
);

vi.mock("./maplerad/customers", () => ({ createCustomer, upgradeCustomerTier1 }));
vi.mock("@cheqpay/db", () => ({
  prisma: {
    user: { findUnique, update },
    $executeRawUnsafe: executeRawUnsafe,
  },
}));

import { ensureMapleradCustomer } from "./mapleradCustomer";

const address = { street: "1 Awolowo Rd", city: "Ikoyi", state: "Lagos", postalCode: "101233" };
const full = {
  firstName: "Ada",
  lastName: "Obi",
  bvn: "12345678901",
  dateOfBirth: "1990-01-02",
  phone: "08031234567",
  address,
};

/** A user row as Prisma would return it for the columns we select. */
function row(over: Record<string, unknown> = {}) {
  return {
    mapleradCustomerId: null,
    mapleradTier: 0,
    addressStreet: null,
    addressCity: null,
    addressState: null,
    addressPostalCode: null,
    ...over,
  };
}

describe("ensureMapleradCustomer", () => {
  beforeEach(() => {
    for (const m of [createCustomer, upgradeCustomerTier1, findUnique, update, executeRawUnsafe]) {
      m.mockReset();
    }
    executeRawUnsafe.mockResolvedValue(undefined);
    update.mockResolvedValue({});
  });

  it("creates the customer from name and email alone, then upgrades", async () => {
    findUnique.mockResolvedValue(row());
    createCustomer.mockResolvedValue({ id: "cus_1" });
    upgradeCustomerTier1.mockResolvedValue(undefined);

    const id = await ensureMapleradCustomer("u1", "ada@example.com", full);

    expect(id).toBe("cus_1");
    expect(createCustomer).toHaveBeenCalledWith({
      first_name: "Ada",
      last_name: "Obi",
      email: "ada@example.com",
      country: "NG",
    });
    expect(upgradeCustomerTier1).toHaveBeenCalledWith(
      expect.objectContaining({
        customer_id: "cus_1",
        identification_number: "12345678901",
        dob: "02-01-1990", // DD-MM-YYYY, not our YYYY-MM-DD
        phone: { phone_country_code: "+234", phone_number: "8031234567" },
      })
    );
  });

  it("still returns a customer id when identity details are missing", async () => {
    // The whole point of the split: an incomplete profile must not leave the
    // user with no customer record, because everything downstream keys off it.
    findUnique.mockResolvedValue(row());
    createCustomer.mockResolvedValue({ id: "cus_2" });

    const id = await ensureMapleradCustomer("u1", "ada@example.com", {
      firstName: "Ada",
      lastName: "Obi",
    });

    expect(id).toBe("cus_2");
    expect(upgradeCustomerTier1).not.toHaveBeenCalled();
  });

  it("retries the upgrade from the stored address, with nothing re-entered", async () => {
    findUnique.mockResolvedValue(
      row({
        mapleradCustomerId: "cus_3",
        addressStreet: address.street,
        addressCity: address.city,
        addressState: address.state,
        addressPostalCode: address.postalCode,
      })
    );
    upgradeCustomerTier1.mockResolvedValue(undefined);

    await ensureMapleradCustomer("u1", "ada@example.com", {
      firstName: "Ada",
      lastName: "Obi",
      bvn: "12345678901",
      dateOfBirth: "1990-01-02",
      phone: "08031234567",
      // no address supplied by the caller
    });

    expect(createCustomer).not.toHaveBeenCalled();
    expect(upgradeCustomerTier1).toHaveBeenCalledWith(
      expect.objectContaining({
        customer_id: "cus_3",
        address: { ...{ street: address.street, city: address.city, state: address.state }, country: "NG", postal_code: address.postalCode },
      })
    );
  });

  it("does not upgrade a customer that is already tier 1", async () => {
    findUnique.mockResolvedValue(row({ mapleradCustomerId: "cus_4", mapleradTier: 1 }));
    const id = await ensureMapleradCustomer("u1", "ada@example.com", full);
    expect(id).toBe("cus_4");
    expect(upgradeCustomerTier1).not.toHaveBeenCalled();
  });

  it("keeps the customer id when the upgrade call fails", async () => {
    findUnique.mockResolvedValue(row({ mapleradCustomerId: "cus_5" }));
    upgradeCustomerTier1.mockRejectedValue(new Error("Access Denied"));

    const id = await ensureMapleradCustomer("u1", "ada@example.com", full);

    // A failed upgrade must not discard the record — it is retried later.
    expect(id).toBe("cus_5");
    expect(update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { mapleradTier: 1 } })
    );
  });
});
