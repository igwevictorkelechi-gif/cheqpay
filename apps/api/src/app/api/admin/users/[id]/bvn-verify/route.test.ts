import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireAdmin,
  findUnique,
  auditCreate,
  decryptPii,
  isPiiEncryptionConfigured,
  lookupBvnIdentity,
} = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  findUnique: vi.fn(),
  auditCreate: vi.fn(),
  decryptPii: vi.fn(),
  isPiiEncryptionConfigured: vi.fn(),
  lookupBvnIdentity: vi.fn(),
}));

vi.mock("@cheqpay/db", () => ({
  prisma: { user: { findUnique }, auditLog: { create: auditCreate } },
}));
vi.mock("@/lib/auth", () => ({ requireAdmin }));
vi.mock("@/lib/pii", () => ({ decryptPii, isPiiEncryptionConfigured }));
vi.mock("@/lib/maplerad/identity", () => ({ lookupBvnIdentity }));
vi.mock("@/lib/mapleradCustomer", () => ({
  describeProviderError: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

import { POST } from "./route";

const NIBSS = {
  firstName: "Victor",
  lastName: "Igwe",
  middleName: "Kelechi",
  dateOfBirth: "1995-04-10",
  phone: "08031234567",
  gender: "Male",
  raw: {},
};

function user(over: Record<string, unknown> = {}) {
  return {
    // Stored surname-first — the mismatch NIBSS rejects at enrolment.
    legalName: "Igwe Victor",
    dateOfBirth: new Date("1995-04-10"),
    bvnCiphertext: "cipher",
    bvnLast4: "7890",
    ...over,
  };
}

function call(body: unknown) {
  return POST(
    new Request("https://api/x", { method: "POST", body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: "u1" }) },
  );
}

describe("POST /api/admin/users/[id]/bvn-verify", () => {
  beforeEach(() => {
    requireAdmin.mockReset().mockResolvedValue(undefined);
    findUnique.mockReset().mockResolvedValue(user());
    auditCreate.mockReset().mockResolvedValue({});
    decryptPii.mockReset().mockReturnValue("12345678901");
    isPiiEncryptionConfigured.mockReset().mockReturnValue(true);
    lookupBvnIdentity.mockReset().mockResolvedValue(NIBSS);
  });

  it("looks up the BVN on file and flags the name-order mismatch", async () => {
    const body = await (await call({})).json();

    expect(decryptPii).toHaveBeenCalled(); // used the stored BVN
    expect(body.identity.firstName).toBe("Victor");
    // We hold "Igwe" as the first name — the mismatch that fails NIBSS.
    expect(body.matches.firstName).toBe(false);
    expect(body.held.firstName).toBe("Igwe");
    // DOB agrees, so it is not the problem.
    expect(body.matches.dateOfBirth).toBe(true);
  });

  it("checks a supplied BVN directly without touching the stored one", async () => {
    const body = await (await call({ bvn: "22222222222" })).json();
    expect(decryptPii).not.toHaveBeenCalled();
    expect(body.source).toBe("supplied");
    expect(lookupBvnIdentity).toHaveBeenCalledWith("22222222222");
  });

  it("returns the provider's reason rather than throwing when NIBSS declines", async () => {
    lookupBvnIdentity.mockRejectedValue(new Error("BVN not found"));
    const res = await call({ bvn: "22222222222" });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/BVN not found/);
  });

  it("audits the lookup by the last 4 only, never the returned identity", async () => {
    await call({ bvn: "22222222222" });
    const audit = auditCreate.mock.calls[0][0].data;
    expect(audit.action).toBe("admin.kyc.bvn_verified");
    expect(audit.details.bvnLast4).toBe("2222");
    expect(JSON.stringify(audit.details)).not.toContain("Victor");
  });

  it("refuses a BVN that is not 11 digits", async () => {
    const res = await call({ bvn: "123" });
    expect(res.status).toBe(422);
    expect(lookupBvnIdentity).not.toHaveBeenCalled();
  });

  it("says so when there is no BVN on file and none supplied", async () => {
    findUnique.mockResolvedValue(user({ bvnCiphertext: null }));
    const res = await call({});
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe("no_bvn");
  });
});
