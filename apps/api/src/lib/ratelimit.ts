import { prisma } from "@cheqpay/db";
import { ApiError } from "./http";

/**
 * Fixed-window rate limiting in two layers:
 *
 *  1. In memory, per instance — free, and stops a burst at the first instance
 *     it hits.
 *  2. In Postgres, shared by every instance — the real limit. On serverless
 *     each instance has its own memory, so an in-memory limit alone can be
 *     multiplied just by spreading requests across instances.
 *
 * If the database is unreachable the shared layer is skipped rather than
 * failing the request: a limiter must never be what takes the product down.
 * The pure decision function is time-injectable for tests.
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

function limited(retryAfterMs: number): ApiError {
  return new ApiError(
    429,
    `Too many requests; retry in ${Math.max(1, Math.ceil(retryAfterMs / 1000))}s`,
    "rate_limited"
  );
}

let tableReady: Promise<void> | null = null;
function ensureRateLimitTable(): Promise<void> {
  if (!tableReady) {
    tableReady = (async () => {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS rate_limits (
          key text PRIMARY KEY,
          window_start timestamptz NOT NULL DEFAULT now(),
          count integer NOT NULL DEFAULT 0
        )`);
    })().catch((err) => {
      tableReady = null;
      throw err;
    });
  }
  return tableReady;
}

/**
 * One atomic statement: start a new window or count into the current one, and
 * return where the count now stands. Concurrent requests on any instance each
 * get a distinct count, so exactly `limit` get through per window.
 */
async function sharedHit(
  key: string,
  windowMs: number
): Promise<{ count: number; resetAt: number }> {
  await ensureRateLimitTable();
  const rows = await prisma.$queryRawUnsafe<{ count: number; window_start: Date }[]>(
    `INSERT INTO rate_limits (key, window_start, count) VALUES ($1, now(), 1)
     ON CONFLICT (key) DO UPDATE SET
       count = CASE WHEN rate_limits.window_start <= now() - ($2::int * interval '1 millisecond')
                    THEN 1 ELSE rate_limits.count + 1 END,
       window_start = CASE WHEN rate_limits.window_start <= now() - ($2::int * interval '1 millisecond')
                    THEN now() ELSE rate_limits.window_start END
     RETURNING count, window_start`,
    key,
    Math.trunc(windowMs)
  );
  const row = rows[0];
  // Old windows are dead weight; sweep them now and then.
  if (Math.random() < 0.01) {
    void prisma
      .$executeRawUnsafe(`DELETE FROM rate_limits WHERE window_start < now() - interval '1 day'`)
      .catch(() => undefined);
  }
  return { count: Number(row.count), resetAt: new Date(row.window_start).getTime() + windowMs };
}

/** Throws ApiError(429) when the limit is exceeded, on this instance or across all of them. */
export async function enforceRateLimit(key: string, limit: number, windowMs: number): Promise<void> {
  const decision = rateLimit(key, limit, windowMs);
  if (!decision.allowed) throw limited(decision.retryAfterMs);

  let shared: { count: number; resetAt: number } | null = null;
  try {
    shared = await sharedHit(key, windowMs);
  } catch (err) {
    console.warn("[ratelimit] shared store unavailable; using per-instance limit", String(err));
  }
  if (shared && shared.count > limit) throw limited(shared.resetAt - Date.now());
}

/** Test helper. */
export function __resetRateLimits(): void {
  store.clear();
}
