import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getAccountForOwner: vi.fn(),
  createAccount: vi.fn(),
  createApiKey: vi.fn(),
  recordDevAudit: vi.fn(),
}));

vi.mock("@cheqpay/db", () => ({ prisma: {} }));
vi.mock("@/lib/auth", () => ({ requireUser: h.requireUser }));
vi.mock("@/lib/features", () => ({ assertFeatureEnabled: vi.fn() }));
vi.mock("@/lib/ratelimit", () => ({ enforceRateLimit: vi.fn() }));
vi.mock("@/lib/requestContext", () => ({ requestContext: () => ({ ip: "1.2.3.4", userAgent: "test" }) }));
vi.mock("@/lib/devapi/accounts", () => ({
  createAccount: h.createAccount,
  getAccountForOwner: h.getAccountForOwner,
  renameAccount: vi.fn(),
}));
vi.mock("@/lib/devapi/keys", () => ({ createApiKey: h.createApiKey, listApiKeys: vi.fn(), keyIsActive: vi.fn() }));
vi.mock("@/lib/devapi/audit", () => ({ recordDevAudit: h.recordDevAudit }));
vi.mock("@/lib/devapi/billing", () => ({ getSubscription: vi.fn(), liveAccessProblem: vi.fn() }));
vi.mock("@/lib/devapi/dashboard", () => ({ requireDeveloper: vi.fn() }));
vi.mock("@/lib/devapi/limits", () => ({ effectiveLimits: vi.fn(), getDevLimits: vi.fn() }));
vi.mock("@/lib/devapi/plans", () => ({ getPlans: vi.fn() }));
vi.mock("@/lib/devapi/serialize", () => ({
  dashboardAccountView: (a: { id: string }) => ({ id: a.id }),
  keyView: (k: { id: string; mode: string }) => ({ id: k.id, mode: k.mode }),
  limitsView: vi.fn(),
  subscriptionView: vi.fn(),
  walletObject: vi.fn(),
}));

import { POST } from "./route";

const open = () =>
  POST(new Request("https://api.test/api/developer/account", { method: "POST", body: JSON.stringify({ business_name: "Acme" }) }));

const account = { id: "acct_1" };
const key = { id: "key_1", mode: "test", label: "First test key", scopes: [], allowed_ips: [] };

beforeEach(() => {
  vi.clearAllMocks();
  h.requireUser.mockResolvedValue({ id: "user_1" });
  h.createAccount.mockResolvedValue(account);
  h.createApiKey.mockResolvedValue({ key, secret: "cp_test_sk_secret" });
});

describe("opening a developer account", () => {
  it("hands a new account a TEST key, once, so the next screen can be a command to run", async () => {
    h.getAccountForOwner.mockResolvedValue(null);
    const res = await open();
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.first_key).toEqual({ key: { id: "key_1", mode: "test" }, secret: "cp_test_sk_secret" });
    expect(h.createApiKey).toHaveBeenCalledWith(account, { mode: "test", label: "First test key" });
    expect(h.recordDevAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "key.created" }));
  });

  it("never makes a live key, whatever happens", async () => {
    h.getAccountForOwner.mockResolvedValue(null);
    await open();
    for (const [, input] of h.createApiKey.mock.calls) expect(input.mode).toBe("test");
  });

  it("does not mint another key when the account already exists", async () => {
    // POST is safe to repeat (a double-tapped button, a retried request); a
    // repeat must not leave a trail of unused secrets behind it.
    h.getAccountForOwner.mockResolvedValue(account);
    const res = await open();
    expect(res.status).toBe(200);
    expect((await res.json()).first_key).toBeNull();
    expect(h.createApiKey).not.toHaveBeenCalled();
  });

  it("still opens the account when the key can't be made", async () => {
    h.getAccountForOwner.mockResolvedValue(null);
    h.createApiKey.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await open();
    expect(res.status).toBe(201);
    expect((await res.json()).first_key).toBeNull();
  });
});
