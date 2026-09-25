import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The shared (Postgres) layer is what makes a limit hold across serverless
 * instances. Here the database is a counter; the in-memory layer is reset each
 * time so only the shared count decides.
 */
const h = vi.hoisted(() => ({ count: 0, fail: false }));

vi.mock("@cheqpay/db", () => ({
  prisma: {
    $executeRawUnsafe: async () => 0,
    $queryRawUnsafe: async () => {
      if (h.fail) throw new Error("db down");
      h.count += 1;
      return [{ count: h.count, window_start: new Date() }];
    },
  },
}));

import { __resetRateLimits, enforceRateLimit } from "./ratelimit";

beforeEach(() => {
  h.count = 0;
  h.fail = false;
});

describe("shared rate limit", () => {
  it("refuses once the count across all instances passes the limit", async () => {
    for (let i = 0; i < 3; i++) {
      __resetRateLimits(); // a fresh instance each time
      await expect(enforceRateLimit("k", 3, 60_000)).resolves.toBeUndefined();
    }
    __resetRateLimits();
    await expect(enforceRateLimit("k", 3, 60_000)).rejects.toMatchObject({ code: "rate_limited" });
  });

  it("falls back to the per-instance limit when the database is down, rather than failing requests", async () => {
    h.fail = true;
    __resetRateLimits();
    await expect(enforceRateLimit("k2", 1, 60_000)).resolves.toBeUndefined();
    await expect(enforceRateLimit("k2", 1, 60_000)).rejects.toMatchObject({ code: "rate_limited" });
  });
});
