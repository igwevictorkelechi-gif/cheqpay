import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  findUnique,
  update,
  recordFindFirst,
  upgradeCustomerTier2,
  ensureMapleradSchema,
  ensureKycDocSchema,
  decryptPii,
  isPiiEncryptionConfigured,
  signKycDocumentUrl,
} = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  recordFindFirst: vi.fn(),
  upgradeCustomerTier2: vi.fn(),
  ensureMapleradSchema: vi.fn(),
  ensureKycDocSchema: vi.fn(),
  decryptPii: vi.fn(),
  isPiiEncryptionConfigured: vi.fn(),
  signKycDocumentUrl: vi.fn(),
}));

vi.mock("@cheqpay/db", () => ({
  prisma: { user: { findUnique, update }, kycRecord: { findFirst: recordFindFirst } },
}));
vi.mock("./maplerad/customers", () => ({ upgradeCustomerTier2 }));
vi.mock("./mapleradCustomer", () => ({ ensureMapleradSchema, ensureKycDocSchema }));
vi.mock("./pii", () => ({ decryptPii, isPiiEncryptionConfigured }));
vi.mock("./kycDocuments", () => ({ signKycDocumentUrl }));

import { upgradeToTier2 } from "./mapleradTier2";

/** A tier-1 customer with a government ID on file — the upgradable shape. */
function tier1User(over: Record<string, unknown> = {}) {
  return {
    mapleradCustomerId: "cus_1",
    mapleradTier: 1,
    idDocType: "NIN",
    idDocNumberCiphertext: "cipher",
    ...over,
  };
}

describe("upgradeToTier2", () => {
  beforeEach(() => {
    findUnique.mockReset().mockResolvedValue(tier1User());
    update.mockReset().mockResolvedValue({});
    recordFindFirst.mockReset().mockResolvedValue({ documentRefs: ["kyc/u1/front", "kyc/u1/back"] });
    upgradeCustomerTier2.mockReset().mockResolvedValue({ id: "cus_1", status: "COMPLETED" });
    ensureMapleradSchema.mockReset().mockResolvedValue(undefined);
    ensureKycDocSchema.mockReset().mockResolvedValue(undefined);
    decryptPii.mockReset().mockReturnValue("22233344455");
    isPiiEncryptionConfigured.mockReset().mockReturnValue(true);
    signKycDocumentUrl.mockReset().mockReturnValue("https://api/signed/front");
  });

  it("sends the stored ID and records tier 2 on success", async () => {
    const r = await upgradeToTier2("u1", "https://api.example.com");

    expect(r).toMatchObject({ upgraded: true, tier: 2 });
    expect(upgradeCustomerTier2).toHaveBeenCalledWith({
      customer_id: "cus_1",
      identity: {
        type: "NIN",
        image: "https://api/signed/front",
        number: "22233344455",
        country: "NG",
      },
    });
    // Only the FRONT image is sent — Maplerad's identity block takes one.
    expect(signKycDocumentUrl).toHaveBeenCalledWith("kyc/u1/front", 3600, "https://api.example.com");
    expect(update).toHaveBeenCalledWith({ where: { id: "u1" }, data: { mapleradTier: 2 } });
  });

  it("refuses without spending a call when the customer is still tier 0", async () => {
    findUnique.mockResolvedValue(tier1User({ mapleradTier: 0 }));

    const r = await upgradeToTier2("u1", "https://api.example.com");

    expect(r.upgraded).toBe(false);
    expect(r.reason).toContain("tier 0");
    expect(upgradeCustomerTier2).not.toHaveBeenCalled();
  });

  it("is a no-op when the customer is already tier 2", async () => {
    findUnique.mockResolvedValue(tier1User({ mapleradTier: 2 }));

    const r = await upgradeToTier2("u1", "https://api.example.com");

    expect(r).toMatchObject({ upgraded: false, tier: 2 });
    expect(upgradeCustomerTier2).not.toHaveBeenCalled();
  });

  it.each([
    ["no ID type", { idDocType: null }, "ID type"],
    ["no ID number", { idDocNumberCiphertext: null }, "ID number"],
  ])("explains what is missing: %s", async (_label, over, expected) => {
    findUnique.mockResolvedValue(tier1User(over));

    const r = await upgradeToTier2("u1", "https://api.example.com");

    expect(r.upgraded).toBe(false);
    expect(r.reason).toContain(expected);
    expect(upgradeCustomerTier2).not.toHaveBeenCalled();
  });

  it("explains a missing document image", async () => {
    recordFindFirst.mockResolvedValue(null);

    const r = await upgradeToTier2("u1", "https://api.example.com");

    expect(r.upgraded).toBe(false);
    expect(r.reason).toContain("document image");
    expect(upgradeCustomerTier2).not.toHaveBeenCalled();
  });

  it("never throws when the provider refuses, and does not record tier 2", async () => {
    upgradeCustomerTier2.mockRejectedValue(new Error("identity mismatch"));

    const r = await upgradeToTier2("u1", "https://api.example.com");

    expect(r.upgraded).toBe(false);
    expect(r.reason).toContain("identity mismatch");
    expect(update).not.toHaveBeenCalled();
  });
});
