import { describe, expect, it } from "vitest";
import { __resetRateLimits, rateLimit } from "./ratelimit";

describe("rateLimit", () => {
  it("allows up to the limit then blocks within the window", () => {
    __resetRateLimits();
    const key = "k1";
    const t0 = 1_000_000;
    expect(rateLimit(key, 3, 60_000, t0).allowed).toBe(true);
    expect(rateLimit(key, 3, 60_000, t0 + 1).allowed).toBe(true);
    expect(rateLimit(key, 3, 60_000, t0 + 2).allowed).toBe(true);
    const blocked = rateLimit(key, 3, 60_000, t0 + 3);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it("resets after the window elapses", () => {
    __resetRateLimits();
    const key = "k2";
    rateLimit(key, 1, 1_000, 0);
    expect(rateLimit(key, 1, 1_000, 500).allowed).toBe(false);
    expect(rateLimit(key, 1, 1_000, 1_001).allowed).toBe(true);
  });

  it("tracks keys independently", () => {
    __resetRateLimits();
    expect(rateLimit("a", 1, 1_000, 0).allowed).toBe(true);
    expect(rateLimit("b", 1, 1_000, 0).allowed).toBe(true);
  });
});
