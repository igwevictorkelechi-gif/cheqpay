import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  queryRaw: vi.fn(),
  executeRaw: vi.fn(),
}));

vi.mock("@cheqpay/db", () => ({
  UserStatus: { ACTIVE: "ACTIVE", SUSPENDED: "SUSPENDED", BLOCKED: "BLOCKED", DELETED: "DELETED" },
  prisma: {
    user: { findUnique: h.userFindUnique },
    $queryRawUnsafe: h.queryRaw,
    $executeRawUnsafe: h.executeRaw,
  },
}));

import { assertAccessAllowed, candidateIps, invalidateAccessCache } from "./accessControl";

function req(headers: Record<string, string> = {}): Request {
  return new Request("https://api.example/api/me", { headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  invalidateAccessCache();
  h.executeRaw.mockResolvedValue(0);
  h.queryRaw.mockResolvedValue([]);
  h.userFindUnique.mockResolvedValue({ status: "ACTIVE" });
});

describe("assertAccessAllowed — account status", () => {
  it("lets an active account through", async () => {
    await expect(assertAccessAllowed(req(), "u1")).resolves.toBeUndefined();
  });

  it.each(["BLOCKED", "SUSPENDED", "DELETED"])("refuses a %s account", async (status) => {
    // Before this, a blocked account kept full API access for as long as its
    // token lived — the 22 Sep account moved money after being blocked.
    h.userFindUnique.mockResolvedValue({ status });
    await expect(assertAccessAllowed(req(), "u1")).rejects.toMatchObject({
      status: 403,
      code: "account_blocked",
    });
  });

  it("does not refuse a caller with no profile row yet (a brand-new signup)", async () => {
    h.userFindUnique.mockResolvedValue(null);
    await expect(assertAccessAllowed(req(), "new")).resolves.toBeUndefined();
  });
});

describe("assertAccessAllowed — IP blocklist", () => {
  it("refuses a request from a blocked address", async () => {
    h.queryRaw.mockResolvedValue([{ ip: "45.11.172.77" }]);
    await expect(
      assertAccessAllowed(req({ "x-forwarded-for": "45.11.172.77" }), "u1"),
    ).rejects.toMatchObject({ status: 403, code: "account_blocked" });
  });

  it("cannot be dodged by forging x-forwarded-for", async () => {
    // The first XFF entry is client-controlled. The platform-set header still
    // carries the real address, and a match on ANY candidate refuses.
    h.queryRaw.mockResolvedValue([{ ip: "45.11.172.77" }]);
    await expect(
      assertAccessAllowed(
        req({ "x-forwarded-for": "1.2.3.4, 45.11.172.77", "x-real-ip": "45.11.172.77" }),
        "u1",
      ),
    ).rejects.toMatchObject({ code: "account_blocked" });
  });

  it("refuses a blocked address even for an account with no profile yet", async () => {
    // A blocked person registering again from the same place is stopped at
    // their very first call.
    h.userFindUnique.mockResolvedValue(null);
    h.queryRaw.mockResolvedValue([{ ip: "34.14.117.197" }]);
    await expect(
      assertAccessAllowed(req({ "x-real-ip": "34.14.117.197" }), "brand-new"),
    ).rejects.toMatchObject({ code: "account_blocked" });
  });

  it("lets other addresses through", async () => {
    h.queryRaw.mockResolvedValue([{ ip: "45.11.172.77" }]);
    await expect(
      assertAccessAllowed(req({ "x-forwarded-for": "102.89.1.1" }), "u1"),
    ).resolves.toBeUndefined();
  });
});

describe("candidateIps", () => {
  it("collects every address from every forwarding header, normalised", () => {
    const ips = candidateIps(
      req({
        "x-forwarded-for": "1.1.1.1, ::ffff:2.2.2.2",
        "x-real-ip": "3.3.3.3",
        "x-vercel-forwarded-for": "4.4.4.4",
      }),
    );
    expect(ips.sort()).toEqual(["1.1.1.1", "2.2.2.2", "3.3.3.3", "4.4.4.4"]);
  });
});
