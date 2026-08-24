import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireUser, findUnique, assertFeatureEnabled, getUsdAccount, createUsdVirtualAccount } =
  vi.hoisted(() => ({
    requireUser: vi.fn(),
    findUnique: vi.fn(),
    assertFeatureEnabled: vi.fn(),
    getUsdAccount: vi.fn(),
    createUsdVirtualAccount: vi.fn(),
  }));

vi.mock("@cheqpay/db", () => ({ prisma: { user: { findUnique } } }));
vi.mock("@/lib/auth", () => ({ requireUser }));
vi.mock("@/lib/features", () => ({ assertFeatureEnabled }));
vi.mock("@/lib/usdAccount", () => ({ getUsdAccount, createUsdVirtualAccount }));

import { POST } from "./route";

const validBody = {
  identificationNumber: "TN-12364",
  employmentStatus: "EMPLOYED",
  employmentDescription: "Software engineering",
  nationality: "NG",
  employerName: "CheqPay",
  usResidencyStatus: "NON_RESIDENT_ALIEN",
};

function call(body: unknown) {
  return POST(new Request("https://api/x", { method: "POST", body: JSON.stringify(body) }));
}

describe("POST /api/virtual-accounts/usd", () => {
  beforeEach(() => {
    requireUser.mockReset().mockResolvedValue({ id: "u1" });
    findUnique.mockReset().mockResolvedValue({ mapleradCustomerId: "cus_1" });
    assertFeatureEnabled.mockReset().mockResolvedValue(undefined);
    getUsdAccount.mockReset();
    createUsdVirtualAccount.mockReset().mockResolvedValue({
      accountNumber: "8300000001",
      bankName: "CFSB",
      currency: "USD",
      consentRequired: false,
    });
  });

  it("opens the account, mapping the form to Maplerad's meta keys", async () => {
    const res = await call(validBody);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.usdAccount.accountNumber).toBe("8300000001");
    expect(createUsdVirtualAccount).toHaveBeenCalledWith("u1", {
      identification_number: "TN-12364",
      employment_status: "EMPLOYED",
      employment_description: "Software engineering",
      nationality: "NG",
      employer_name: "CheqPay",
      us_residency_status: "NON_RESIDENT_ALIEN",
    });
  });

  it("rejects an unenrolled user with 409 before calling the provider", async () => {
    findUnique.mockResolvedValue({ mapleradCustomerId: null });
    const res = await call(validBody);
    expect(res.status).toBe(409);
    expect(createUsdVirtualAccount).not.toHaveBeenCalled();
  });

  it("rejects a bad employment status (422 validation)", async () => {
    const res = await call({ ...validBody, employmentStatus: "MOONLIGHTING" });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(createUsdVirtualAccount).not.toHaveBeenCalled();
  });

  it("maps a lib not_enrolled error to a clean 409", async () => {
    createUsdVirtualAccount.mockRejectedValue(new Error("not_enrolled"));
    const res = await call(validBody);
    expect(res.status).toBe(409);
  });
});
