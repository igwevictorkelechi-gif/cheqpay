// The public pay-target lookup must (a) never leak PII beyond what a user hands
// out to get paid, and (b) refuse to act as a username -> account-number
// enumeration oracle: without the token issued for a username, it 404s exactly
// as it does for an unknown user. The token logic here is the real one.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/features", () => ({ assertFeatureEnabled: vi.fn(async () => undefined) }));
vi.mock("@/lib/ratelimit", () => ({ enforceRateLimit: vi.fn(async () => undefined) }));

const findFirst = vi.fn();
vi.mock("@cheqpay/db", () => ({ prisma: { user: { findFirst: (...a: unknown[]) => findFirst(...a) } } }));

const getVirtualAccount = vi.fn();
vi.mock("@/lib/virtualAccounts", () => ({ getVirtualAccount: (...a: unknown[]) => getVirtualAccount(...a) }));

import { GET } from "./route";
import { payToken } from "@/lib/payLink";

const ACTIVE = { id: "u1", username: "victor", status: "ACTIVE" };

function call(username: string, token: string | null) {
  const url = `https://api.test/api/pay/${username}${token === null ? "" : `?c=${token}`}`;
  return GET(new Request(url), { params: Promise.resolve({ username }) });
}

describe("GET /api/pay/[username]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns username, bank name/number and the bank display name — and nothing else", async () => {
    findFirst.mockResolvedValueOnce(ACTIVE);
    getVirtualAccount.mockResolvedValueOnce({
      accountNumber: "0123456789",
      bankName: "Test Bank",
      accountName: "VICTOR KELECHI",
      permanent: true,
    });
    const res = await call("victor", payToken("victor"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      username: "victor",
      displayName: "VICTOR KELECHI",
      ngn: { bankName: "Test Bank", accountNumber: "0123456789" },
    });
  });

  it("omits ngn when the user has no Naira account yet", async () => {
    findFirst.mockResolvedValueOnce(ACTIVE);
    getVirtualAccount.mockResolvedValueOnce(null);
    const res = await call("victor", payToken("victor"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ username: "victor", displayName: null, ngn: null });
  });

  it("404s without the token, without ever querying for the user", async () => {
    const res = await call("victor", null);
    expect(res.status).toBe(404);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("404s on a token minted for a different username", async () => {
    const res = await call("victor", payToken("someoneelse"));
    expect(res.status).toBe(404);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("404s for an unknown or inactive user even with a valid token", async () => {
    findFirst.mockResolvedValueOnce(null);
    const res = await call("victor", payToken("victor"));
    expect(res.status).toBe(404);
  });

  it("404s on a malformed username before doing any work", async () => {
    const res = await call("ab", payToken("ab"));
    expect(res.status).toBe(404);
    expect(findFirst).not.toHaveBeenCalled();
  });
});
