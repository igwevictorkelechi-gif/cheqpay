import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  main: vi.fn(),
  sub: vi.fn(),
  otpConfigured: vi.fn(),
  otpConsume: vi.fn(),
}));

vi.mock("@cheqpay/db", () => ({ prisma: { auditLog: { create: vi.fn().mockResolvedValue({}) } } }));
vi.mock("@/lib/auth", () => ({ hasAdminServiceSecret: () => false }));
vi.mock("@/lib/ratelimit", () => ({ enforceRateLimit: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/adminCreds", () => ({
  verifyAdminLogin: h.main,
  verifySubAdminLogin: h.sub,
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
});

describe("admin login", () => {
  it("the main login is always a Super Admin", async () => {
    h.main.mockResolvedValue(true);
    const res = await login({ email: "admin@cheqpay.com", password: "x", otp: "123456" });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ role: "super", mustChangePassword: false, epoch: "ep1" });
  });

  it("a sub admin signs in without the authenticator, as a sub admin, told to change password", async () => {
    h.sub.mockResolvedValue({ email: "sub@mycheqpay.com", mustChange: true });
    const res = await login({ email: "sub@mycheqpay.com", password: "Starting-pass-2026" });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ email: "sub@mycheqpay.com", role: "admin", mustChangePassword: true });
    expect(h.otpConsume).not.toHaveBeenCalled();
  });

  it("refuses a wrong password", async () => {
    const res = await login({ email: "sub@mycheqpay.com", password: "wrong" });
    expect(res.status).toBe(401);
  });
});
