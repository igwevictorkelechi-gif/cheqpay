import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createCustomer,
  enrollCustomer,
  upgradeCustomerTier1,
  getCustomer,
  findUnique,
  update,
  executeRawUnsafe,
} = vi.hoisted(() => ({
  createCustomer: vi.fn(),
  enrollCustomer: vi.fn(),
  upgradeCustomerTier1: vi.fn(),
  getCustomer: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  executeRawUnsafe: vi.fn(),
}));

vi.mock("./maplerad/customers", async () => {
  // hasTier1Evidence is pure, so the real one is used rather than a stub — the
  // point of these tests is which remote shapes count as already-upgraded.
  const real = await vi.importActual<typeof import("./maplerad/customers")>(
    "./maplerad/customers"
  );
  return {
    createCustomer,
    enrollCustomer,
    upgradeCustomerTier1,
    getCustomer,
    hasTier1Evidence: real.hasTier1Evidence,
  };
});
vi.mock("@cheqpay/db", () => ({
  prisma: {
    user: { findUnique, update },
    $executeRawUnsafe: executeRawUnsafe,
  },
}));

import { MapleradError } from "./maplerad/client";
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
    for (const m of [createCustomer, enrollCustomer, upgradeCustomerTier1, getCustomer, findUnique, update, executeRawUnsafe]) {
      m.mockReset();
    }
    executeRawUnsafe.mockResolvedValue(undefined);
    update.mockResolvedValue({});
  });

  it("enrolls in one full call when the whole identity is present", async () => {
    // Complete data takes the happy path: a single /customers/enroll instead of
    // tier-0 create + tier-1 upgrade, for a customer with full access.
    findUnique.mockResolvedValue(row());
    enrollCustomer.mockResolvedValue({ id: "cus_1", tier: 2 });

    const id = await ensureMapleradCustomer("u1", "ada@example.com", full);

    expect(id).toBe("cus_1");
    expect(enrollCustomer).toHaveBeenCalledWith(
      expect.objectContaining({
        first_name: "Ada",
        last_name: "Obi",
        email: "ada@example.com",
        country: "NG",
        identification_number: "12345678901",
        dob: "02-01-1990", // DD-MM-YYYY, not our YYYY-MM-DD
        phone: { phone_country_code: "+234", phone_number: "8031234567" },
        address: expect.objectContaining({ country: "NG", postal_code: address.postalCode }),
      })
    );
    // No fallback and no separate upgrade — enroll did it all.
    expect(createCustomer).not.toHaveBeenCalled();
    expect(upgradeCustomerTier1).not.toHaveBeenCalled();
    // The tier is read from the enroll response, not assumed.
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { mapleradCustomerId: "cus_1", mapleradTier: 2 } })
    );
  });

  it("forwards the government ID to the full enroll when present", async () => {
    findUnique.mockResolvedValue(row());
    enrollCustomer.mockResolvedValue({ id: "cus_9", tier: 2 });

    await ensureMapleradCustomer("u1", "ada@example.com", {
      ...full,
      identity: { type: "NIN", number: "22233344455", imageUrl: "https://signed/front.jpg" },
    });

    expect(enrollCustomer).toHaveBeenCalledWith(
      expect.objectContaining({
        identity: {
          type: "NIN",
          image: "https://signed/front.jpg",
          number: "22233344455",
          country: "NG",
        },
      })
    );
  });

  it("enrolls without an identity block when none was resolved", async () => {
    findUnique.mockResolvedValue(row());
    enrollCustomer.mockResolvedValue({ id: "cus_10", tier: 2 });

    await ensureMapleradCustomer("u1", "ada@example.com", full);

    const arg = enrollCustomer.mock.calls[0][0];
    expect(arg).not.toHaveProperty("identity");
  });

  it("falls back to the tier-0 create when a required field is missing", async () => {
    // Missing phone: enroll would 400, so open the tier-0 customer instead and
    // leave the upgrade for a later submission. A record must always exist.
    findUnique.mockResolvedValue(row());
    createCustomer.mockResolvedValue({ id: "cus_2" });

    const { phone: _omit, ...noPhone } = full;
    const id = await ensureMapleradCustomer("u1", "ada@example.com", noPhone);

    expect(id).toBe("cus_2");
    expect(enrollCustomer).not.toHaveBeenCalled();
    expect(createCustomer).toHaveBeenCalledWith({
      first_name: "Ada",
      last_name: "Obi",
      email: "ada@example.com",
      country: "NG",
    });
    // Phone is the missing field, so the upgrade is skipped this time.
    expect(upgradeCustomerTier1).not.toHaveBeenCalled();
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
    expect(enrollCustomer).not.toHaveBeenCalled();
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

/**
 * A customer id can be set by hand — a customer opened on the Maplerad
 * dashboard has to be pasted into the user row to connect the two — so it
 * arrives with no guarantee that it exists and with maplerad_tier still 0
 * whatever its real tier is.
 */
describe("ensureMapleradCustomer — reconciling an id it did not create", () => {
  // This describe needs the same reset as the one above; a beforeEach declared
  // inside another describe does not apply here, and the leaked state made a
  // rejected getCustomer look like a successful one.
  beforeEach(() => {
    for (const m of [createCustomer, enrollCustomer, upgradeCustomerTier1, getCustomer, findUnique, update, executeRawUnsafe]) {
      m.mockReset();
    }
    executeRawUnsafe.mockResolvedValue(undefined);
    update.mockResolvedValue({});
  });

  const remote = {
    id: "cus_dash",
    first_name: "Ada",
    last_name: "Obi",
    email: "ada@example.com",
    phone_number: "+2348031234567",
    dob: "02-01-1990",
    identity: { type: "BVN", number: "12345678901", country: "NG" },
    address: { street: "1 Awolowo Rd", city: "Ikoyi", state: "Lagos", postal_code: "101233" },
    status: "COMPLETED",
  };

  it("records tier 1 from Maplerad's own record instead of re-upgrading", async () => {
    findUnique.mockResolvedValue(row({ mapleradCustomerId: "cus_dash" }));
    getCustomer.mockResolvedValue(remote);

    const id = await ensureMapleradCustomer("u1", "ada@example.com", full);

    expect(id).toBe("cus_dash");
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { mapleradTier: 1 } })
    );
    // The evidence is already on file; sending it again buys nothing.
    expect(upgradeCustomerTier1).not.toHaveBeenCalled();
    expect(createCustomer).not.toHaveBeenCalled();
  });

  it("still upgrades when Maplerad holds the customer but not the identity", async () => {
    findUnique.mockResolvedValue(row({ mapleradCustomerId: "cus_dash" }));
    getCustomer.mockResolvedValue({ ...remote, identity: null, address: null, dob: null });
    upgradeCustomerTier1.mockResolvedValue(undefined);

    await ensureMapleradCustomer("u1", "ada@example.com", full);

    expect(upgradeCustomerTier1).toHaveBeenCalled();
  });

  it("clears an id Maplerad has never heard of, so a real one can be created", async () => {
    // A mistyped id would otherwise wedge the account forever: every later call
    // fails against it while the code keeps assuming enrolment is done.
    findUnique.mockResolvedValue(row({ mapleradCustomerId: "cus_typo" }));
    const notFound = new MapleradError("Customer not found", 404);
    getCustomer.mockRejectedValue(notFound);

    const id = await ensureMapleradCustomer("u1", "ada@example.com", full);

    expect(id).toBeNull();
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { mapleradCustomerId: null, mapleradTier: 0 } })
    );
  });

  it("keeps the id when the provider is merely unreachable", async () => {
    // The distinction that matters: a 401/403/timeout must not discard a good
    // link, or an outage would mint a duplicate customer for every user.
    findUnique.mockResolvedValue(row({ mapleradCustomerId: "cus_dash" }));
    getCustomer.mockRejectedValue(new MapleradError("Unauthorized", 401));
    upgradeCustomerTier1.mockResolvedValue(undefined);

    const id = await ensureMapleradCustomer("u1", "ada@example.com", full);

    expect(id).toBe("cus_dash");
    expect(update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { mapleradCustomerId: null, mapleradTier: 0 } })
    );
  });
});
