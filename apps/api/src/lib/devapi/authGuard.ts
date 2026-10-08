// apps/api/src/lib/devapi/authGuard.ts
//
// Slowing down anyone guessing keys. Every failed authentication counts
// against the caller's IP; 20 in a minute blocks that IP for 15 minutes, on
// every server (the count lives in Postgres). A 256-bit key can't be guessed,
// so this is less about guessing than about noise: a scanner hammering the API
// with junk keys stops costing us database work, and ops hears about it.

import { prisma } from "@cheqpay/db";
import { ApiError } from "../http";
import { alertOpsOnce } from "../opsAlert";
import { ensureDevApiSchema } from "./ensureDevApi";

export const MAX_FAILURES_PER_MINUTE = 20;
export const BLOCK_MINUTES = 15;

const clearUntil = new Map<string, number>();
const blockedUntil = new Map<string, number>();

function tooMany(until: number): ApiError {
  const err = new ApiError(
    429,
    `Too many requests with invalid API keys from your IP address. Try again in ${Math.max(1, Math.ceil((until - Date.now()) / 60_000))} minutes.`,
    "too_many_failed_attempts",
  );
  (err as ApiError & { retryAfterSeconds?: number }).retryAfterSeconds = Math.max(1, Math.ceil((until - Date.now()) / 1000));
  return err;
}

/** Throws 429 while `ip` is blocked. A clean IP is remembered for 5 s per server to save the lookup. */
export async function assertNotBlocked(ip: string | null, now: number = Date.now()): Promise<void> {
  if (!ip) return;
  const local = blockedUntil.get(ip);
  if (local && local > now) throw tooMany(local);
  const clear = clearUntil.get(ip);
  if (clear && clear > now) return;
  await ensureDevApiSchema();
  const rows = await prisma.$queryRawUnsafe<{ blocked_until: Date }[]>(
    `SELECT blocked_until FROM dev_auth_failures WHERE ip = $1 AND blocked_until > now()`,
    ip,
  );
  if (rows[0]) {
    blockedUntil.set(ip, rows[0].blocked_until.getTime());
    throw tooMany(rows[0].blocked_until.getTime());
  }
  if (clearUntil.size > 5_000) clearUntil.clear();
  clearUntil.set(ip, now + 5_000);
}

/** Count one failed authentication from `ip`, blocking it when it crosses the limit. */
export async function noteAuthFailure(ip: string | null): Promise<void> {
  if (!ip) return;
  clearUntil.delete(ip);
  try {
    await ensureDevApiSchema();
    const rows = await prisma.$queryRawUnsafe<{ failures: number }[]>(
      `INSERT INTO dev_auth_failures (ip, window_start, failures) VALUES ($1, now(), 1)
       ON CONFLICT (ip) DO UPDATE SET
         failures = CASE WHEN dev_auth_failures.window_start <= now() - interval '1 minute' THEN 1 ELSE dev_auth_failures.failures + 1 END,
         window_start = CASE WHEN dev_auth_failures.window_start <= now() - interval '1 minute' THEN now() ELSE dev_auth_failures.window_start END
       RETURNING failures`,
      ip,
    );
    if ((rows[0]?.failures ?? 0) >= MAX_FAILURES_PER_MINUTE) {
      await prisma.$executeRawUnsafe(
        `UPDATE dev_auth_failures SET blocked_until = now() + ($2::int * interval '1 minute') WHERE ip = $1`,
        ip,
        BLOCK_MINUTES,
      );
      blockedUntil.set(ip, Date.now() + BLOCK_MINUTES * 60_000);
      void alertOpsOnce(`devapi-authfail:${ip}`, `🔑 Developer API: ${MAX_FAILURES_PER_MINUTE}+ invalid keys in a minute from ${ip}; blocked for ${BLOCK_MINUTES} minutes.`);
    }
  } catch (err) {
    console.warn("[devapi] could not record a failed authentication", String(err));
  }
}

/** Tests only. */
export function __resetAuthGuard(): void {
  clearUntil.clear();
  blockedUntil.clear();
}
