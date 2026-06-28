import { ApiError } from "./http";

/**
 * Best-effort in-memory fixed-window rate limiter. Adequate for a single
 * instance; in serverless/multi-instance production back this with a shared
 * store (Vercel KV / Upstash Redis). The decision function is pure + time-
 * injectable for tests.
 */
interface Bucket {
  count: number;
  resetAt: number;
}
const store = new Map<string, Bucket>();

export interface RateDecision {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now()
): RateDecision {
  const bucket = store.get(key);
  if (!bucket || bucket.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfterMs: 0 };
  }
  if (bucket.count >= limit) {
    return { allowed: false, remaining: 0, retryAfterMs: bucket.resetAt - now };
  }
  bucket.count += 1;
  return { allowed: true, remaining: limit - bucket.count, retryAfterMs: 0 };
}

/** Throws ApiError(429) when the limit is exceeded. */
export function enforceRateLimit(key: string, limit: number, windowMs: number): void {
  const decision = rateLimit(key, limit, windowMs);
  if (!decision.allowed) {
    throw new ApiError(
      429,
      `Too many requests; retry in ${Math.ceil(decision.retryAfterMs / 1000)}s`,
      "rate_limited"
    );
  }
}

/** Test helper. */
export function __resetRateLimits(): void {
  store.clear();
}
