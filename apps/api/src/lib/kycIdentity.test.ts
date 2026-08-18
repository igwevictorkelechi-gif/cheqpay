import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  update,
  findUnique,
  buildRetainedIdentity,
  encryptPii,
  last4,
  ensureRetentionSchema,
  ensureMapleradSchema,
  ensureKycDocSchema,
} = vi.hoisted(() => ({
  update: vi.fn(),
  findUnique: vi.fn(),
  buildRetainedIdentity: vi.fn(),
  encryptPii: vi.fn(),
  last4: vi.fn(),
  ensureRetentionSchema: vi.fn(),
  ensureMapleradSchema: vi.fn(),
  ensureKycDocSchema: vi.fn(),
}));

vi.mock("@cheqpay/db", () => ({ prisma: { user: { update, findUnique } }, Prisma: {} }));
// The encryption itself is covered by pii.test.ts; here we only care that the
// identity it returns is folded into the single write, so stubs are enough.
vi.mock("./pii", () => ({ buildRetainedIdentity, encryptPii, last4 }));
vi.mock("./retention", () => ({ ensureRetentionSchema }));
vi.mock("./mapleradCustomer", () => ({ ensureMapleradSchema, ensureKycDocSchema }));

import { persistKycIdentity } from "./kycIdentity";

const address = { street: "1 Awolowo Rd", city: "Ikoyi", state: "Lagos", postalCode: "101233" };
const base = {
  legalName: "Ada Obi",
  bvn: "12345678901",
  dateOfBirth: "1990-01-02",
  phone: "08031234567",
  address,
  idDoc: { type: "NIN", number: "22233344455" },
};

describe("persistKycIdentity", () => {
  beforeEach(() => {
    for (const m of [
      update,
      findUnique,
      buildRetainedIdentity,
      encryptPii,
      last4,
      ensureRetentionSchema,
      ensureMapleradSchema,
      ensureKycDocSchema,
    ]) {
      m.mockReset();
    }
    ensureRetentionSchema.mockResolvedValue(undefined);
    ensureMapleradSchema.mockResolvedValue(undefined);
    ensureKycDocSchema.mockResolvedValue(undefined);
    encryptPii.mockImplementation((v: string) => `v1:enc(${v})`);
    last4.mockImplementation((v: string) => v.slice(-4));
    update.mockResolvedValue({});
    findUnique.mockResolvedValue({ phone: null });
    // Echo the legal name, and the encrypted BVN fields only when a BVN is given.
    buildRetainedIdentity.mockImplementation((input: { legalName: string; bvn?: string }) => ({
      identity: {
        legalName: input.legalName,
        ...(input.bvn
          ? { bvnCiphertext: "v1:ct", bvnFingerprint: "fp", bvnLast4: "8901" }
          : {}),
      },
      problem: null,
    }));
  });

  it("writes name, encrypted BVN, date of birth and address in one update", async () => {
    await persistKycIdentity("u1", base);

    const call = update.mock.calls.find((c) => c[0].where.id === "u1" && "legalName" in c[0].data);
    expect(call).toBeDefined();
    const data = call![0].data;
    expect(data).toMatchObject({
      legalName: "Ada Obi",
      bvnCiphertext: "v1:ct",
      bvnFingerprint: "fp",
      bvnLast4: "8901",
      addressStreet: address.street,
      addressCity: address.city,
      addressState: address.state,
      addressPostalCode: address.postalCode,
    });
    // DOB is stored as a real Date, not the YYYY-MM-DD string.
    expect(data.dateOfBirth).toBeInstanceOf(Date);
    expect((data.dateOfBirth as Date).toISOString().slice(0, 10)).toBe("1990-01-02");
  });

  it("stores the government ID: type in the clear, number encrypted + last4", async () => {
    await persistKycIdentity("u1", base);

    const data = update.mock.calls.find((c) => "legalName" in c[0].data)![0].data;
    expect(data.idDocType).toBe("NIN");
    expect(data.idDocNumberCiphertext).toBe("v1:enc(22233344455)");
    expect(data.idDocNumberLast4).toBe("4455");
    expect(encryptPii).toHaveBeenCalledWith("22233344455");
  });

  it("omits the ID fields when no document is supplied", async () => {
    await persistKycIdentity("u1", { ...base, idDoc: undefined });
    const data = update.mock.calls.find((c) => "legalName" in c[0].data)![0].data;
    expect(data).not.toHaveProperty("idDocType");
    expect(data).not.toHaveProperty("idDocNumberCiphertext");
  });

  it("keeps the ID type even if number encryption fails", async () => {
    encryptPii.mockImplementation(() => {
      throw new Error("bad key");
    });
    await persistKycIdentity("u1", base);
    const data = update.mock.calls.find((c) => "legalName" in c[0].data)![0].data;
    expect(data.idDocType).toBe("NIN");
    expect(data).not.toHaveProperty("idDocNumberCiphertext");
  });

  it("omits the BVN fields when the user did not supply one", async () => {
    await persistKycIdentity("u1", { ...base, bvn: undefined });

    const data = update.mock.calls.find((c) => "legalName" in c[0].data)![0].data;
    expect(data.legalName).toBe("Ada Obi");
    expect(data).not.toHaveProperty("bvnCiphertext");
  });

  it("fills the phone only when it is currently empty", async () => {
    await persistKycIdentity("u1", base);
    expect(update).toHaveBeenCalledWith({ where: { id: "u1" }, data: { phone: "08031234567" } });
  });

  it("does not overwrite an existing phone", async () => {
    findUnique.mockResolvedValue({ phone: "08099999999" });
    await persistKycIdentity("u1", base);
    expect(update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { phone: expect.anything() } })
    );
  });

  it("skips the phone on a unique conflict without failing the identity write", async () => {
    // Identity write succeeds; the phone write (second update) collides.
    update.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("Unique constraint failed"));
    await expect(persistKycIdentity("u1", base)).resolves.toBeUndefined();
  });

  it("propagates a real database failure so the KYC flow stops before Maplerad", async () => {
    update.mockRejectedValueOnce(new Error("connection terminated"));
    await expect(persistKycIdentity("u1", base)).rejects.toThrow("connection terminated");
  });
});
