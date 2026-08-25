import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireAdmin,
  findUnique,
  findFirst,
  update,
  ensureMapleradSchema,
  ensureMapleradCustomerDetailed,
  createVirtualAccount,
  decryptPii,
  encryptPii,
  fingerprintPii,
  last4,
  isPiiEncryptionConfigured,
  auditCreate,
} = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  findUnique: vi.fn(),
  findFirst: vi.fn(),
  update: vi.fn(),
  ensureMapleradSchema: vi.fn(),
  ensureMapleradCustomerDetailed: vi.fn(),
  createVirtualAccount: vi.fn(),
  decryptPii: vi.fn(),
  encryptPii: vi.fn(),
  fingerprintPii: vi.fn(),
  last4: vi.fn(),
  isPiiEncryptionConfigured: vi.fn(),
  auditCreate: vi.fn(),
}));

vi.mock("@cheqpay/db", () => ({
  prisma: { user: { findUnique, findFirst, update }, auditLog: { create: auditCreate } },
}));
vi.mock("@/lib/pregenerateWallets", () => ({ pregenerateCryptoWallets: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAdmin }));
vi.mock("@/lib/pii", () => ({ decryptPii, encryptPii, fingerprintPii, last4, isPiiEncryptionConfigured }));
vi.mock("@/lib/mapleradCustomer", () => ({ ensureMapleradCustomerDetailed, ensureMapleradSchema }));
vi.mock("@/lib/virtualAccounts", () => ({ createVirtualAccount }));

import { POST } from "./route";

/** A user with everything on file EXCEPT the phone — the stuck-at-tier-0 shape. */
function stuckUser(over: Record<string, unknown> = {}) {
  return {
    id: "u1",
    email: "ada@example.com",
    phone: "", // the empty string that blocks the tier-1 enrol
    legalName: "Ada Obi",
    dateOfBirth: new Date("2000-02-14"),
    bvnCiphertext: "cipher",
    addressStreet: "1 Rd",
    addressCity: "Asaba",
    addressState: "Delta",
    addressPostalCode: "322101",
    mapleradCustomerId: "cus_1",
    mapleradTier: 0,
    ...over,
  };
}

function call(body: unknown) {
  return POST(
    new Request("https://api/x", { method: "POST", body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: "u1" }) },
  );
}

describe("POST /api/admin/users/[id]/maplerad/enroll", () => {
  beforeEach(() => {
    requireAdmin.mockReset().mockResolvedValue(undefined);
    findUnique.mockReset().mockResolvedValue(stuckUser());
    findFirst.mockReset().mockResolvedValue(null);
    update.mockReset().mockResolvedValue({});
    ensureMapleradSchema.mockReset().mockResolvedValue(undefined);
    ensureMapleradCustomerDetailed.mockReset().mockResolvedValue({ customerId: "cus_1" });
    createVirtualAccount.mockReset().mockResolvedValue({
      accountNumber: "9900000001",
      bankName: "Moniepoint MFB",
    });
    decryptPii.mockReset().mockReturnValue("12345678901");
    isPiiEncryptionConfigured.mockReset().mockReturnValue(true);
    encryptPii.mockReset().mockReturnValue("new-cipher");
    fingerprintPii.mockReset().mockReturnValue("new-fp");
    last4.mockReset().mockReturnValue("9999");
    auditCreate.mockReset().mockResolvedValue({});
  });

  it("stores a supplied phone in +234 form and enrols with the stored identity", async () => {
    // Tier moves to 1 once the provider accepts.
    findUnique
      .mockResolvedValueOnce(stuckUser())
      .mockResolvedValueOnce({ mapleradCustomerId: "cus_1", mapleradTier: 1 });

    const res = await call({ phone: "08031234567" });
    expect(res.status).toBe(200);
    const body = await res.json();

    // Leading 0 stripped, dial code applied.
    expect(update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { phone: "+2348031234567" },
    });
    expect(body.phoneOutcome).toContain("+2348031234567");

    // Enrolment used what was already on file, not anything re-typed.
    const arg = ensureMapleradCustomerDetailed.mock.calls[0][2];
    expect(arg).toMatchObject({
      firstName: "Ada",
      lastName: "Obi",
      bvn: "12345678901",
      dateOfBirth: "2000-02-14",
      phone: "+2348031234567",
      address: { street: "1 Rd", city: "Asaba", state: "Delta", postalCode: "322101" },
    });

    expect(body.tierBefore).toBe(0);
    expect(body.tier).toBe(1);
    expect(body.account).toMatchObject({ accountNumber: "9900000001" });
  });

  it("names the account holding a duplicate number instead of failing silently", async () => {
    // This is the case persistKycIdentity used to swallow.
    findFirst.mockResolvedValue({ id: "u2", email: "someone@else.com" });

    const res = await call({ phone: "08031234567" });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("someone@else.com");
    expect(update).not.toHaveBeenCalled();
    expect(ensureMapleradCustomerDetailed).not.toHaveBeenCalled();
  });

  it("rejects a number that is not 10 digits", async () => {
    const res = await call({ phone: "0803" });
    expect(res.status).toBe(422);
    expect(ensureMapleradCustomerDetailed).not.toHaveBeenCalled();
  });

  it("reports what is still missing rather than calling the provider", async () => {
    findUnique.mockResolvedValue(stuckUser({ bvnCiphertext: null, addressStreet: null }));

    const res = await call({});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.enrolled).toBe(false);
    expect(body.missing).toEqual(expect.arrayContaining(["bvn", "phone", "address"]));
    expect(ensureMapleradCustomerDetailed).not.toHaveBeenCalled();
  });

  it("does not provision an account while the customer is still tier 0", async () => {
    findUnique
      .mockResolvedValueOnce(stuckUser())
      .mockResolvedValueOnce({ mapleradCustomerId: "cus_1", mapleradTier: 0 });

    const body = await (await call({ phone: "08031234567" })).json();
    expect(createVirtualAccount).not.toHaveBeenCalled();
    expect(body.tier).toBe(0);
    expect(body.message).toContain("Still tier 0");
  });

  it("requires admin", async () => {
    requireAdmin.mockRejectedValue(new Error("Admin privileges required"));
    const res = await call({ phone: "08031234567" });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(findUnique).not.toHaveBeenCalled();
  });

/**
 * Identity corrections. "could not validate BVN" from NIBSS is usually a name
 * entered surname-first or a wrong digit, not a bad BVN — so an operator can
 * correct the name / DOB / BVN in place and re-validate without the user
 * redoing KYC. These lock in that a correction is persisted, audited, and
 * carried into the enrol, and that a bad correction is refused.
 */
describe("identity correction on the enrol repair", () => {
  beforeEach(() => {
    findUnique
      .mockResolvedValueOnce(stuckUser({ phone: "+2348031234567" }))
      .mockResolvedValueOnce({ mapleradCustomerId: "cus_1", mapleradTier: 1 });
  });

  it("re-orders a surname-first name and enrols with it", async () => {
    // Stored "Igwe Victor" would split to first=Igwe — the mismatch NIBSS
    // rejects. The operator supplies the correct halves.
    const res = await call({ firstName: "Victor", lastName: "Igwe" });
    expect(res.status).toBe(200);

    // Persisted as a single legal name...
    expect(update).toHaveBeenCalledWith({ where: { id: "u1" }, data: { legalName: "Victor Igwe" } });
    // ...and passed to the provider in the right order.
    const arg = ensureMapleradCustomerDetailed.mock.calls[0][2];
    expect(arg.firstName).toBe("Victor");
    expect(arg.lastName).toBe("Igwe");
    // And the change is on the audit log, by field name only.
    const audit = auditCreate.mock.calls[0][0].data;
    expect(audit.action).toBe("admin.kyc.identity_corrected");
    expect(audit.details.fields).toContain("legal name");
  });

  it("re-encrypts a corrected BVN three ways and enrols with it", async () => {
    const res = await call({ bvn: "22222222222" });
    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { bvnCiphertext: "new-cipher", bvnFingerprint: "new-fp", bvnLast4: "9999" },
    });
    expect(ensureMapleradCustomerDetailed.mock.calls[0][2].bvn).toBe("22222222222");
  });

  it("stores a corrected date of birth and sends it in the enrol", async () => {
    const res = await call({ dateOfBirth: "1990-05-06" });
    expect(res.status).toBe(200);
    expect(ensureMapleradCustomerDetailed.mock.calls[0][2].dateOfBirth).toBe("1990-05-06");
  });

  it("refuses a half-supplied name rather than sending a mismatched pair", async () => {
    const res = await call({ firstName: "Victor" });
    expect(res.status).toBe(422);
    expect(ensureMapleradCustomerDetailed).not.toHaveBeenCalled();
  });

  it("refuses a BVN that is not 11 digits", async () => {
    const res = await call({ bvn: "123" });
    expect(res.status).toBe(422);
    expect(update).not.toHaveBeenCalled();
  });

  it("refuses a corrected BVN when PII encryption is off, rather than storing it in the clear", async () => {
    isPiiEncryptionConfigured.mockReturnValue(false);
    const res = await call({ bvn: "22222222222" });
    expect(res.status).toBe(503);
    expect(encryptPii).not.toHaveBeenCalled();
  });
});

});
