import { beforeEach, describe, expect, it, vi } from "vitest";

const { walletFindUnique, walletUpdate, checkRequestStatus } = vi.hoisted(() => ({
  walletFindUnique: vi.fn(),
  walletUpdate: vi.fn(),
  checkRequestStatus: vi.fn(),
}));

vi.mock("@cheqpay/db", () => ({
  Asset: { USD: "USD" },
  Network: { FIAT: "FIAT" },
  Prisma: { PrismaClientKnownRequestError: class {} },
  prisma: { wallet: { findUnique: walletFindUnique, update: walletUpdate } },
}));
vi.mock("./maplerad/accounts", () => ({
  checkUsdAccountRequestStatus: checkRequestStatus,
  createUsdAccount: vi.fn(),
}));
vi.mock("./ensureUsdAsset", () => ({ ensureUsdAsset: vi.fn() }));

import { checkUsdAccountStatus } from "./usdAccount";

const metaWith = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    providerRef: "acc_1",
    requestReference: "ref-123",
    bankName: "CFSB",
    currency: "USD",
    status: "PENDING",
    consentRequired: false,
    ...over,
  });

describe("checkUsdAccountStatus", () => {
  beforeEach(() => {
    walletFindUnique.mockReset();
    walletUpdate.mockReset().mockResolvedValue({});
    checkRequestStatus.mockReset();
  });

  it("returns null when the user has no USD account", async () => {
    walletFindUnique.mockResolvedValue(null);
    expect(await checkUsdAccountStatus("u1")).toBeNull();
    expect(checkRequestStatus).not.toHaveBeenCalled();
  });

  it("returns null (nothing to poll) for a legacy account with no reference", async () => {
    walletFindUnique.mockResolvedValue({ address: "8300", custodyRef: metaWith({ requestReference: null }) });
    expect(await checkUsdAccountStatus("u1")).toBeNull();
    expect(checkRequestStatus).not.toHaveBeenCalled();
  });

  it("polls with the stored reference and surfaces messages + kyc link", async () => {
    walletFindUnique.mockResolvedValue({ address: "8300", custodyRef: metaWith() });
    checkRequestStatus.mockResolvedValue({
      reference: "ref-123",
      account_id: "acc_1",
      status: "APPROVED",
      message: ["Proof of address is missing the customer's name."],
      currency: "USD",
      kyc_link: "https://maplerad.com/kyc",
    });

    const r = await checkUsdAccountStatus("u1");
    expect(checkRequestStatus).toHaveBeenCalledWith("ref-123");
    expect(r).toEqual({
      status: "APPROVED",
      messages: ["Proof of address is missing the customer's name."],
      currency: "USD",
      kycLink: "https://maplerad.com/kyc",
      accountId: "acc_1",
    });
  });

  it("persists a changed status back onto the wallet meta", async () => {
    walletFindUnique.mockResolvedValue({ address: "8300", custodyRef: metaWith({ status: "PENDING" }) });
    checkRequestStatus.mockResolvedValue({
      reference: "ref-123",
      account_id: "acc_1",
      status: "APPROVED",
      currency: "USD",
    });

    await checkUsdAccountStatus("u1");
    expect(walletUpdate).toHaveBeenCalledTimes(1);
    const written = JSON.parse(walletUpdate.mock.calls[0][0].data.custodyRef);
    expect(written.status).toBe("APPROVED");
    expect(written.requestReference).toBe("ref-123");
  });

  it("does not write when the status is unchanged", async () => {
    walletFindUnique.mockResolvedValue({ address: "8300", custodyRef: metaWith({ status: "PENDING" }) });
    checkRequestStatus.mockResolvedValue({
      reference: "ref-123",
      account_id: "acc_1",
      status: "PENDING",
      currency: "USD",
    });

    await checkUsdAccountStatus("u1");
    expect(walletUpdate).not.toHaveBeenCalled();
  });
});
