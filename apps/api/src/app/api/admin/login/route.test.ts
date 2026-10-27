import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  main: vi.fn(),
  sub: vi.fn(),
  otpConfigured: vi.fn(),
  otpConsume: vi.fn(),
  subOtp: vi.fn(),
}));

vi.mock("@cheqpay/db", () => ({ prisma: { auditLog: { create: vi.fn().mockResolvedValue({}) } } }));
vi.mock("@/lib/auth", () => ({ hasAdminServiceSecret: () => false }));
vi.mock("@/lib/ratelimit", () => ({ enforceRateLimit: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/adminCreds", () => ({
  verifyAdminLogin: h.main,
  verifySubAdminLogin: h.sub,
  consumeSubAdminOtp: h.subOtp,
  getAdminEmail: async () => "admin@cheqpay.com",
}));
vi.mock("@/lib/totp", () => ({ isAdminOtpConfigured: h.otpConfigured, consumeAdminOtp: h.otpConsume }));
vi.mock("@/lib/adminSession", () => ({ getAdminSessionEpoch: async () => "ep1" }));
vi.mock("@/lib/requestContext", () => ({ clientIp: () => "1.2.3.4" }));
vi.mock("@/lib/accessControl", () => ({ isIpBlocked: async () => false }));

import { POST } from "./route";

const login = (body: Record<string, string>) =>
  POST(new Request("https://api.example/api/admin/login", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  h.main.mockResolvedValue(false);
  h.sub.mockResolvedValue(null);
  h.otpConfigured.mockResolvedValue(true);
  h.otpConsume.mockResolvedValue(true);
  h.subOtp.mockResolvedValue(true);
});

describe("admin login", () => {
  it("the main login is always a Super Admin", async () => {
    h.main.mockResolvedValue(true);
    const res = await login({ email: "admin@cheqpay.com", password: "x", otp: "123456" });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ role: "super", mustChangePassword: false, epoch: "ep1" });
  });

  it("a sub admin signs in without the authenticator, as a sub admin, told to change password", async () => {
    h.sub.mockResolvedValue({ email: "sub@mycheqpay.com", mustChange: true, sections: [], otpEnrolled: false });
    const res = await login({ email: "sub@mycheqpay.com", password: "Starting-pass-2026" });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ email: "sub@mycheqpay.com", role: "admin", mustChangePassword: true });
    expect(h.otpConsume).not.toHaveBeenCalled();
  });

  it("a sub admin with their own authenticator signs in with a code from it, and gets their sections", async () => {
    h.sub.mockResolvedValue({ email: "sub@mycheqpay.com", mustChange: false, sections: ["giftcards"], otpEnrolled: true });
    const noCode = await login({ email: "sub@mycheqpay.com", password: "Own-password-2026" });
    expect(noCode.status).toBe(401);
    await expect(noCode.json()).resolves.toMatchObject({ code: "otp_required" });

    h.subOtp.mockResolvedValueOnce(false);
    const badCode = await login({ email: "sub@mycheqpay.com", password: "Own-password-2026", otp: "111111" });
    await expect(badCode.json()).resolves.toMatchObject({ code: "bad_otp" });

    const ok = await login({ email: "sub@mycheqpay.com", password: "Own-password-2026", otp: "222222" });
    expect(ok.status).toBe(200);
    await expect(ok.json()).resolves.toMatchObject({ role: "admin", sections: ["giftcards"] });
    expect(h.subOtp).toHaveBeenLastCalledWith("sub@mycheqpay.com", "222222");
    // Their own code, never the owner's.
    expect(h.otpConsume).not.toHaveBeenCalled();
  });

  it("refuses a wrong password", async () => {
    const res = await login({ email: "sub@mycheqpay.com", password: "wrong" });
    expect(res.status).toBe(401);
  });
});
