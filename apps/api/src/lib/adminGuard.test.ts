import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  settingFind: vi.fn(),
  settingUpsert: vi.fn(),
  otpConfigured: vi.fn(),
  otpConsume: vi.fn(),
}));

vi.mock("@cheqpay/db", () => ({
  UserStatus: { ACTIVE: "ACTIVE", SUSPENDED: "SUSPENDED", BLOCKED: "BLOCKED", DELETED: "DELETED" },
  prisma: {
    platformSetting: { findUnique: h.settingFind, upsert: h.settingUpsert },
    user: { findUnique: vi.fn().mockResolvedValue({ status: "ACTIVE" }) },
    $queryRawUnsafe: vi.fn().mockResolvedValue([]),
    $executeRawUnsafe: vi.fn().mockResolvedValue(0),
    auditLog: { create: vi.fn() },
  },
}));
vi.mock("./totp", () => ({
  isAdminOtpConfigured: h.otpConfigured,
  consumeAdminOtp: h.otpConsume,
}));
vi.mock("./activity", () => ({ touchActivity: vi.fn() }));

const SECRET = "s".repeat(32);
process.env.ADMIN_API_SECRET = SECRET;

import { requireAdminActor, requireAdminOtp } from "./adminGuard";

function req(headers: Record<string, string>): Request {
  return new Request("https://api.example/api/admin/x", { method: "POST", headers });
}
const good = {
  "x-admin-secret": SECRET,
  "x-admin-actor": "owner@cheqpay.com",
  "x-admin-role": "super",
  "x-admin-epoch": "epoch-1",
};

beforeEach(() => {
  vi.clearAllMocks();
  h.settingFind.mockResolvedValue({ key: "admin_session_epoch", value: "epoch-1" });
  h.otpConfigured.mockResolvedValue(true);
  h.otpConsume.mockResolvedValue(true);
});

describe("requireAdminActor", () => {
  it("names the signed-in admin", async () => {
    await expect(requireAdminActor(req(good))).resolves.toEqual({
      email: "owner@cheqpay.com",
      role: "super",
    });
  });

  it("refuses an anonymous dashboard call", async () => {
    // Every line of the 22 Sep audit trail reads "admin". Never again.
    const { "x-admin-actor": _drop, ...anon } = good;
    await expect(requireAdminActor(req(anon))).rejects.toMatchObject({
      status: 401,
      code: "admin_identity_required",
    });
    await expect(requireAdminActor(req({ ...good, "x-admin-actor": "admin-dashboard" }))).rejects.toMatchObject({
      code: "admin_identity_required",
    });
  });

  it("refuses a session minted before the last revocation", async () => {
    await expect(
      requireAdminActor(req({ ...good, "x-admin-epoch": "epoch-0" })),
    ).rejects.toMatchObject({ status: 401, code: "admin_session_revoked" });
  });

  it("keeps Super-Admin-only actions for Super Admins", async () => {
    await expect(
      requireAdminActor(req({ ...good, "x-admin-role": "admin" }), { superOnly: true }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("refuses a wrong service secret outright", async () => {
    await expect(requireAdminActor(req({ ...good, "x-admin-secret": "x".repeat(32) }))).rejects.toBeTruthy();
  });
});

describe("requireAdminOtp", () => {
  it("refuses when no authenticator is enrolled, instead of skipping the check", async () => {
    h.otpConfigured.mockResolvedValue(false);
    await expect(requireAdminOtp(req({ "x-admin-otp": "123456" }))).rejects.toMatchObject({
      code: "otp_not_configured",
    });
  });

  it("refuses a missing code", async () => {
    await expect(requireAdminOtp(req({}))).rejects.toMatchObject({ code: "otp_required" });
  });

  it("refuses a wrong or reused code", async () => {
    h.otpConsume.mockResolvedValue(false);
    await expect(requireAdminOtp(req({ "x-admin-otp": "123456" }))).rejects.toMatchObject({ code: "bad_otp" });
  });

  it("accepts a fresh code from the header or the body", async () => {
    await expect(requireAdminOtp(req({ "x-admin-otp": "123456" }))).resolves.toBeUndefined();
    await expect(requireAdminOtp(req({}), "654321")).resolves.toBeUndefined();
    expect(h.otpConsume).toHaveBeenLastCalledWith("654321");
  });
});
