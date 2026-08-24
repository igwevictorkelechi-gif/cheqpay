import { beforeEach, describe, expect, it, vi } from "vitest";

const { walletFindUnique, walletCreate, userFindUnique, createUsdAccount, ensureUsdAsset } =
  vi.hoisted(() => ({
    walletFindUnique: vi.fn(),
    walletCreate: vi.fn(),
    userFindUnique: vi.fn(),
    createUsdAccount: vi.fn(),
    ensureUsdAsset: vi.fn(),
  }));

vi.mock("@cheqpay/db", () => ({
  Asset: { USD: "USD", NGN: "NGN" },
  Network: { FIAT: "FIAT" },
  Prisma: { PrismaClientKnownRequestError: class extends Error { code = "P2002"; } },
  prisma: {
    wallet: { findUnique: walletFindUnique, create: walletCreate },
    user: { findUnique: userFindUnique },
  },
}));
vi.mock("./maplerad/accounts", () => ({ createUsdAccount }));
vi.mock("./ensureUsdAsset", () => ({ ensureUsdAsset }));

import { createUsdVirtualAccount, getUsdAccount } from "./usdAccount";

const meta = {
  identification_number: "TN-12364",
  employment_status: "EMPLOYED",
  employment_description: "IT",
  nationality: "NG",
  employer_name: "CheqPay",
  us_residency_status: "NON_RESIDENT_ALIEN",
};

const providerAccount = {
  id: "acc-1",
  bank_name: "Community Federal Savings Bank",
  account_number: "8300000001",
  account_name: "Victor Igwe",
  currency: "USD",
  created_at: "2026-08-24",
  status: "PENDING",
  require_consent: true,
  consented: false,
  consent_url: "https://consent.example/abc",
};

describe("USD virtual account", () => {
  beforeEach(() => {
    walletFindUnique.mockReset().mockResolvedValue(null);
    walletCreate.mockReset().mockResolvedValue({});
    userFindUnique.mockReset().mockResolvedValue({ mapleradCustomerId: "cus_1" });
    createUsdAccount.mockReset().mockResolvedValue(providerAccount);
    ensureUsdAsset.mockReset().mockResolvedValue(undefined);
  });

  it("opens the account, adds the USD enum first, and stores it as a USD/FIAT wallet", async () => {
    const view = await createUsdVirtualAccount("u1", meta);

    // The enum value is guaranteed before the typed write.
    expect(ensureUsdAsset).toHaveBeenCalled();
    expect(createUsdAccount).toHaveBeenCalledWith({ customerId: "cus_1", meta });
    expect(walletCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "u1",
          asset: "USD",
          network: "FIAT",
          address: "8300000001",
        }),
      }),
    );

    // The consent flow is surfaced, not swallowed.
    expect(view).toMatchObject({
      accountNumber: "8300000001",
      currency: "USD",
      consentRequired: true,
      consentUrl: "https://consent.example/abc",
    });
  });

  it("refuses when the user is not enrolled with the provider", async () => {
    userFindUnique.mockResolvedValue({ mapleradCustomerId: null });

    await expect(createUsdVirtualAccount("u1", meta)).rejects.toThrow("not_enrolled");
    expect(createUsdAccount).not.toHaveBeenCalled();
  });

  it("is idempotent — an existing account is returned without a provider call", async () => {
    walletFindUnique.mockResolvedValue({
      address: "8300000001",
      custodyRef: JSON.stringify({ bankName: "CFSB", currency: "USD", consentRequired: false }),
    });

    const view = await createUsdVirtualAccount("u1", meta);

    expect(createUsdAccount).not.toHaveBeenCalled();
    expect(view.accountNumber).toBe("8300000001");
  });

  it("getUsdAccount returns null when none exists", async () => {
    expect(await getUsdAccount("u1")).toBeNull();
  });
});
