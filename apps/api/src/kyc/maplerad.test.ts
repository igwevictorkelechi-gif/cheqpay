import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock is hoisted above every const in the file, so the spy has to be
// created inside vi.hoisted or the factory closes over a temporal-dead-zone
// binding and the whole module fails to load.
const { verifyBvn } = vi.hoisted(() => ({ verifyBvn: vi.fn() }));
vi.mock("@/lib/maplerad/identity", () => ({ verifyBvn }));

import { MapleradKycProvider } from "./maplerad";

const registry = {
  first_name: "Ada",
  last_name: "Obi",
  middle_name: "Ngozi",
  dob: "1990-01-02",
  phone_number: "08031234567",
};

const submitted = { firstName: "Ada", lastName: "Obi", bvn: "12345678901" };

describe("Maplerad KYC provider", () => {
  beforeEach(() => {
    verifyBvn.mockReset();
  });

  it("verifies to tier 2 when the registry name matches", async () => {
    verifyBvn.mockResolvedValue(registry);
    const r = await new MapleradKycProvider().verify(submitted);
    expect(r.verified).toBe(true);
    expect(r.tier).toBe(2);
    expect(verifyBvn).toHaveBeenCalledWith("12345678901");
  });

  it("matches names leniently on case and whitespace", async () => {
    verifyBvn.mockResolvedValue({ ...registry, first_name: "  ADA ", last_name: "obi" });
    const r = await new MapleradKycProvider().verify(submitted);
    expect(r.verified).toBe(true);
  });

  it("sends a mismatched name to review rather than approving it", async () => {
    verifyBvn.mockResolvedValue({ ...registry, last_name: "Okafor" });
    const r = await new MapleradKycProvider().verify(submitted);
    expect(r.verified).toBe(false);
    expect(r.reason).toMatch(/did not match/i);
  });

  it("does not gate on the registry date of birth", async () => {
    // Placeholder dates are common in BVN data; rejecting on one would turn a
    // registry defect into a user who cannot open an account.
    verifyBvn.mockResolvedValue({ ...registry, dob: "1964-01-10" });
    const r = await new MapleradKycProvider().verify({ ...submitted, dateOfBirth: "1990-01-02" });
    expect(r.verified).toBe(true);
  });

  it("requires a well-formed BVN before calling the provider", async () => {
    for (const bvn of [undefined, "", "123", "1234567890a"]) {
      const r = await new MapleradKycProvider().verify({ ...submitted, bvn });
      expect(r.verified).toBe(false);
    }
    expect(verifyBvn).not.toHaveBeenCalled();
  });

  it("falls through to review when the lookup fails", async () => {
    verifyBvn.mockImplementation(async () => {
      throw new Error("Access Denied");
    });
    const r = await new MapleradKycProvider().verify(submitted);
    expect(r.verified).toBe(false);
    // The operator needs the provider's own words to tell an IP problem from a
    // bad BVN; the user is not told their identity was rejected.
    expect(r.reason).toMatch(/Access Denied/);
    expect(r.reason).not.toMatch(/did not match/i);
  });

  it("keeps the BVN out of the provider reference", async () => {
    verifyBvn.mockResolvedValue(registry);
    const r = await new MapleradKycProvider().verify(submitted);
    // providerRef reaches the audit log in clear.
    expect(r.providerRef).not.toContain("12345678901");
  });
});
