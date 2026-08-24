import { beforeEach, describe, expect, it, vi } from "vitest";

const { findUnique, update, recordFindFirst, recordUpdate, auditCreate } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  recordFindFirst: vi.fn(),
  recordUpdate: vi.fn(),
  auditCreate: vi.fn(),
}));

vi.mock("@cheqpay/db", () => ({
  KycStatus: { PENDING: "PENDING", APPROVED: "APPROVED", REJECTED: "REJECTED" },
  prisma: {
    user: { findUnique, update },
    kycRecord: { findFirst: recordFindFirst, update: recordUpdate },
    auditLog: { create: auditCreate },
  },
}));

import { grantTierFromEnrolment } from "./kycAutoTier";

describe("grantTierFromEnrolment", () => {
  beforeEach(() => {
    findUnique.mockReset();
    update.mockReset().mockResolvedValue({});
    recordFindFirst.mockReset().mockResolvedValue({ id: "rec-1" });
    recordUpdate.mockReset().mockResolvedValue({});
    auditCreate.mockReset().mockResolvedValue({});
  });

  it("grants tier 1 when the provider enrolled the customer at tier 1", async () => {
    findUnique.mockResolvedValue({ kycTier: 0, mapleradTier: 1 });

    const r = await grantTierFromEnrolment("u1");

    expect(r).toMatchObject({ granted: true, tier: 1 });
    expect(update).toHaveBeenCalledWith({ where: { id: "u1" }, data: { kycTier: 1 } });
    // The submission sitting in review is approved so the UI stops saying PENDING.
    expect(recordUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "rec-1" } }),
    );
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "kyc.auto_approved.provider_enrolment" }),
      }),
    );
  });

  it("does nothing while the provider customer is still tier 0", async () => {
    findUnique.mockResolvedValue({ kycTier: 0, mapleradTier: 0 });

    const r = await grantTierFromEnrolment("u1");

    expect(r.granted).toBe(false);
    expect(r.reason).toContain("tier 0");
    expect(update).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it("never lowers an existing higher tier", async () => {
    findUnique.mockResolvedValue({ kycTier: 2, mapleradTier: 1 });

    const r = await grantTierFromEnrolment("u1");

    expect(r).toMatchObject({ granted: false, tier: 2 });
    expect(update).not.toHaveBeenCalled();
  });

  it("leaves a REJECTED record alone (only a PENDING one is approved)", async () => {
    findUnique.mockResolvedValue({ kycTier: 0, mapleradTier: 1 });
    recordFindFirst.mockResolvedValue(null); // the query filters to PENDING

    const r = await grantTierFromEnrolment("u1");

    expect(r.granted).toBe(true);
    expect(recordUpdate).not.toHaveBeenCalled();
    // The tier is still granted — an operator's rejection of an older
    // submission must not block a provider-verified customer.
    expect(update).toHaveBeenCalled();
  });

  it("never throws — a promotion failure must not fail the submission", async () => {
    findUnique.mockRejectedValue(new Error("db down"));

    await expect(grantTierFromEnrolment("u1")).resolves.toMatchObject({ granted: false });
  });
});
