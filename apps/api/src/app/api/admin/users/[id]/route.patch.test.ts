import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PATCH /api/admin/users/[id] — the rules written after the 22 Sep incident, in
 * which an account with no identity on file was raised to KYC tier 3, blocked,
 * then unblocked twenty minutes later so it could withdraw.
 */

const h = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  executeRaw: vi.fn(),
  actor: vi.fn(),
  otp: vi.fn(),
  record: vi.fn(),
  revoke: vi.fn(),
  lift: vi.fn(),
  blockIps: vi.fn(),
  knownIps: vi.fn(),
}));

vi.mock("@cheqpay/db", () => ({
  Asset: { NGN: "NGN" },
  Network: { FIAT: "FIAT" },
  UserStatus: { ACTIVE: "ACTIVE", SUSPENDED: "SUSPENDED", BLOCKED: "BLOCKED", DELETED: "DELETED" },
  prisma: {
    user: { findUnique: h.findUnique, update: h.update },
    $executeRawUnsafe: h.executeRaw,
  },
}));
vi.mock("@/lib/auth", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/adminGuard", () => ({
  requireAdminActor: h.actor,
  requireAdminOtp: h.otp,
  recordAdminAction: h.record,
}));
vi.mock("@/lib/accessControl", () => ({
  blockIps: h.blockIps,
  ensureBlockedIpsSchema: vi.fn(),
  invalidateAccessCache: vi.fn(),
  knownIpsForUser: h.knownIps,
  liftAuthBan: h.lift,
  revokeAuthSessions: h.revoke,
}));
vi.mock("@/lib/kycDocuments", () => ({ signKycDocumentUrl: vi.fn(), resolveApiOrigin: vi.fn() }));
vi.mock("@/lib/activity", () => ({ ensureActivitySchema: vi.fn() }));
vi.mock("@/lib/mapleradCustomer", () => ({ ensureMapleradSchema: vi.fn(), ensureKycDocSchema: vi.fn() }));

import { PATCH } from "./route";

const verified = {
  id: "u1",
  email: "ada@example.com",
  status: "ACTIVE",
  kycTier: 0,
  legalName: "Ada Obi",
  bvnFingerprint: "fp",
  idDocType: "NIN",
  idDocNumberLast4: "4455",
};
/** The 22 Sep account: nothing on file. */
const anonymous = {
  ...verified,
  email: "xeyahol463@kingdais.com",
  legalName: null,
  bvnFingerprint: null,
  idDocType: null,
  idDocNumberLast4: null,
};

function patch(body: Record<string, unknown>) {
  return PATCH(
    new Request("https://api.example/api/admin/users/u1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "u1" }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  h.actor.mockResolvedValue({ email: "ops@cheqpay.com", role: "super" });
  h.otp.mockResolvedValue(undefined);
  h.findUnique.mockResolvedValue(verified);
  h.update.mockImplementation(async ({ data }) => ({ ...verified, ...data }));
  h.revoke.mockResolvedValue(true);
  h.knownIps.mockResolvedValue(["45.11.172.77"]);
  h.blockIps.mockImplementation(async (ips: string[]) => ips);
  h.executeRaw.mockResolvedValue(0);
});

describe("blocking", () => {
  it("is one step: no authenticator code, and it actually stops the account", async () => {
    const res = await patch({ status: "BLOCKED" });
    expect(res.status).toBe(200);
    expect(h.otp).not.toHaveBeenCalled();
    // Ends their sessions and bans them at the login layer…
    expect(h.revoke).toHaveBeenCalledWith("u1");
    // …and blocklists every address they used.
    expect(h.blockIps).toHaveBeenCalledWith(["45.11.172.77"], expect.objectContaining({ sourceUserId: "u1" }));
    expect(h.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "BLOCKED", instantWithdrawal: false }) }),
    );
  });

  it("is attributed to the admin who did it", async () => {
    await patch({ status: "BLOCKED" });
    expect(h.record).toHaveBeenCalledWith(
      expect.anything(),
      { email: "ops@cheqpay.com", role: "super" },
      expect.objectContaining({ action: "admin.user.update" }),
    );
  });
});

describe("unblocking", () => {
  beforeEach(() => h.findUnique.mockResolvedValue({ ...verified, status: "BLOCKED" }));

  it("needs a Super Admin", async () => {
    h.actor.mockResolvedValue({ email: "ops@cheqpay.com", role: "admin" });
    const res = await patch({ status: "ACTIVE", reason: "verified with the customer by phone" });
    expect(res.status).toBe(403);
    expect(h.update).not.toHaveBeenCalled();
  });

  it("needs a reason", async () => {
    const res = await patch({ status: "ACTIVE" });
    expect(res.status).toBe(422);
    expect(h.update).not.toHaveBeenCalled();
  });

  it("needs a fresh authenticator code", async () => {
    h.otp.mockRejectedValue(Object.assign(new Error("code"), { status: 403, code: "otp_required" }));
    const res = await patch({ status: "ACTIVE", reason: "verified with the customer by phone" });
    expect(res.status).not.toBe(200);
    expect(h.update).not.toHaveBeenCalled();
  });

  it("with all three, restores the account and lifts the login ban", async () => {
    const res = await patch({ status: "ACTIVE", reason: "verified with the customer by phone" });
    expect(res.status).toBe(200);
    expect(h.otp).toHaveBeenCalled();
    expect(h.lift).toHaveBeenCalledWith("u1");
  });
});

describe("raising a KYC tier", () => {
  it("refuses an account with no identity on file — the 22 Sep case", async () => {
    h.findUnique.mockResolvedValue(anonymous);
    for (const kycTier of [1, 3]) {
      const res = await patch({ kycTier, reason: "manual review completed" });
      expect(res.status).toBe(422);
    }
    expect(h.update).not.toHaveBeenCalled();
  });

  it("needs a government ID for tier 2", async () => {
    h.findUnique.mockResolvedValue({ ...verified, idDocType: null, idDocNumberLast4: null });
    const res = await patch({ kycTier: 2 });
    expect(res.status).toBe(422);
    expect(h.update).not.toHaveBeenCalled();
  });

  it("needs a Super Admin and a reason for tier 3", async () => {
    h.actor.mockResolvedValue({ email: "ops@cheqpay.com", role: "admin" });
    expect((await patch({ kycTier: 3, reason: "enhanced due diligence done" })).status).toBe(403);
    h.actor.mockResolvedValue({ email: "ops@cheqpay.com", role: "super" });
    expect((await patch({ kycTier: 3 })).status).toBe(422);
    expect(h.update).not.toHaveBeenCalled();
  });

  it("with identity on file and a code, raises the tier", async () => {
    const res = await patch({ kycTier: 1 });
    expect(res.status).toBe(200);
    expect(h.otp).toHaveBeenCalled();
    expect(h.update).toHaveBeenCalledWith(expect.objectContaining({ data: { kycTier: 1 } }));
  });

  it("lowering a tier needs no code", async () => {
    h.findUnique.mockResolvedValue({ ...verified, kycTier: 3 });
    const res = await patch({ kycTier: 0 });
    expect(res.status).toBe(200);
    expect(h.otp).not.toHaveBeenCalled();
  });
});
