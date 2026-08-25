import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireAdmin,
  findUnique,
  findFirst,
  update,
  ensureMapleradSchema,
  ensureMapleradCustomer,
  createVirtualAccount,
  decryptPii,
  isPiiEncryptionConfigured,
} = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  findUnique: vi.fn(),
  findFirst: vi.fn(),
  update: vi.fn(),
  ensureMapleradSchema: vi.fn(),
  ensureMapleradCustomer: vi.fn(),
  createVirtualAccount: vi.fn(),
  decryptPii: vi.fn(),
  isPiiEncryptionConfigured: vi.fn(),
}));

vi.mock("@cheqpay/db", () => ({ prisma: { user: { findUnique, findFirst, update } } }));
vi.mock("@/lib/pregenerateWallets", () => ({ pregenerateCryptoWallets: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAdmin }));
vi.mock("@/lib/pii", () => ({ decryptPii, isPiiEncryptionConfigured }));
vi.mock("@/lib/mapleradCustomer", () => ({ ensureMapleradCustomer, ensureMapleradSchema }));
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
    ensureMapleradCustomer.mockReset().mockResolvedValue("cus_1");
    createVirtualAccount.mockReset().mockResolvedValue({
      accountNumber: "9900000001",
      bankName: "Moniepoint MFB",
    });
    decryptPii.mockReset().mockReturnValue("12345678901");
    isPiiEncryptionConfigured.mockReset().mockReturnValue(true);
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
    const arg = ensureMapleradCustomer.mock.calls[0][2];
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
    expect(ensureMapleradCustomer).not.toHaveBeenCalled();
  });

  it("rejects a number that is not 10 digits", async () => {
    const res = await call({ phone: "0803" });
    expect(res.status).toBe(422);
    expect(ensureMapleradCustomer).not.toHaveBeenCalled();
  });

  it("reports what is still missing rather than calling the provider", async () => {
    findUnique.mockResolvedValue(stuckUser({ bvnCiphertext: null, addressStreet: null }));

    const res = await call({});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.enrolled).toBe(false);
    expect(body.missing).toEqual(expect.arrayContaining(["bvn", "phone", "address"]));
    expect(ensureMapleradCustomer).not.toHaveBeenCalled();
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
});
