import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock is hoisted above every const in the file, so the spy has to be
// created inside vi.hoisted or the factory closes over a temporal-dead-zone
// binding and the whole module fails to load.
const { ensureMapleradCustomer } = vi.hoisted(() => ({ ensureMapleradCustomer: vi.fn() }));
vi.mock("@/lib/mapleradCustomer", () => ({ ensureMapleradCustomer }));

import { MapleradKycProvider } from "./maplerad";

const base = {
  firstName: "Ada",
  lastName: "Obi",
  bvn: "12345678901",
  dateOfBirth: "1990-01-02",
  phone: "08031234567",
  address: { street: "1 Awolowo Rd", city: "Ikoyi", state: "Lagos", postalCode: "101233" },
  userId: "u-1",
  email: "ada@example.com",
};

describe("Maplerad KYC provider", () => {
  beforeEach(() => ensureMapleradCustomer.mockReset());

  it("verifies at tier 1 when enrollment returns a customer id", async () => {
    ensureMapleradCustomer.mockResolvedValue("cus_123");
    const r = await new MapleradKycProvider().verify(base);
    expect(r.verified).toBe(true);
    expect(r.tier).toBe(1);
    // The customer id is the audit trail back to Maplerad.
    expect(r.providerRef).toBe("cus_123");
  });

  it("passes the whole customer record through, not just BVN and name", async () => {
    ensureMapleradCustomer.mockResolvedValue("cus_123");
    await new MapleradKycProvider().verify(base);
    const [userId, email, input] = ensureMapleradCustomer.mock.calls[0];
    expect(userId).toBe("u-1");
    expect(email).toBe("ada@example.com");
    // Tier 1 is refused without these, so losing any of them in the hand-off
    // would look like the user's identity was rejected.
    expect(input).toMatchObject({
      bvn: "12345678901",
      dateOfBirth: "1990-01-02",
      phone: "08031234567",
      address: base.address,
    });
  });

  it("does not verify when enrollment yields nothing", async () => {
    ensureMapleradCustomer.mockResolvedValue(null);
    const r = await new MapleradKycProvider().verify(base);
    expect(r.verified).toBe(false);
    expect(r.tier).toBe(0);
    // Ambiguous outcome — must not be reported to the user as a rejected BVN.
    expect(r.reason).not.toMatch(/rejected/i);
  });

  it("reports a caller mistake rather than an unverified user", async () => {
    const r = await new MapleradKycProvider().verify({ ...base, userId: undefined });
    expect(r.verified).toBe(false);
    expect(r.reason).toMatch(/user id and email/i);
    // Never reach the provider with an incomplete call.
    expect(ensureMapleradCustomer).not.toHaveBeenCalled();
  });
});
