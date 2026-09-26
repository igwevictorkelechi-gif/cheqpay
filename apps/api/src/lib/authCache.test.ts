import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@cheqpay/db", () => ({ prisma: {} }));
vi.mock("./activity", () => ({ touchActivity: vi.fn() }));
vi.mock("./accessControl", () => ({ assertAccessAllowed: vi.fn() }));
vi.mock("./adminSession", () => ({ assertSessionCurrent: vi.fn() }));
vi.mock("./adminCreds", () => ({ getSubAdminState: vi.fn() }));

import { resetAuthCache, verifySupabaseJwt } from "./auth";

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const token = (sub: string, expInSec: number) =>
  `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub, aal: "aal1", exp: Math.floor(Date.now() / 1000) + expInSec })}.sig`;

const fetchMock = vi.fn();

beforeEach(() => {
  process.env.AUTH_CACHE_TTL_MS = "60000";
  resetAuthCache();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () =>
    new Response(JSON.stringify({ id: "u1", email: "a@b.co", email_confirmed_at: "2026-01-01" }), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  delete process.env.AUTH_CACHE_TTL_MS;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("login check cache", () => {
  it("asks Supabase once for the many calls one app open makes", async () => {
    const t = token("u1", 3600);
    for (let i = 0; i < 9; i++) await expect(verifySupabaseJwt(t)).resolves.toMatchObject({ id: "u1" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("asks again after a minute", async () => {
    vi.useFakeTimers({ now: Date.now() });
    const t = token("u1", 3600);
    await verifySupabaseJwt(t);
    vi.setSystemTime(Date.now() + 61_000);
    await verifySupabaseJwt(t);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("never keeps a token past its own expiry", async () => {
    vi.useFakeTimers({ now: Date.now() });
    const t = token("u1", 5);
    await verifySupabaseJwt(t);
    vi.setSystemTime(Date.now() + 6_000);
    await verifySupabaseJwt(t);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not remember a refusal", async () => {
    fetchMock.mockImplementationOnce(async () => new Response("{}", { status: 401 }));
    const t = token("u1", 3600);
    await expect(verifySupabaseJwt(t)).rejects.toThrow();
    await expect(verifySupabaseJwt(t)).resolves.toMatchObject({ id: "u1" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps different tokens apart", async () => {
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const auth = new Headers(init.headers).get("Authorization") ?? "";
      const sub = JSON.parse(Buffer.from(auth.split(".")[1], "base64url").toString()).sub;
      return new Response(JSON.stringify({ id: sub }), { status: 200 });
    });
    await expect(verifySupabaseJwt(token("u1", 3600))).resolves.toMatchObject({ id: "u1" });
    await expect(verifySupabaseJwt(token("u2", 3600))).resolves.toMatchObject({ id: "u2" });
  });
});
