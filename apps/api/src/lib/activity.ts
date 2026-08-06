import { prisma } from "@cheqpay/db";
import { requestContext } from "./requestContext";

/**
 * Records where each account is being used from.
 *
 * Called from `requireUser`, so it covers every authenticated request without
 * 40 call sites needing to remember. Two things follow from that placement:
 *
 *  - It must never block or fail a request. A security log that can take the
 *    API down with it is a worse problem than the one it solves, so every call
 *    is fire-and-forget and every error is swallowed after logging.
 *  - It must not write on every request. Throttled to one write per account per
 *    THROTTLE_MS; the point is "which devices and places", not a hit-by-hit
 *    trace, and an unthrottled version would add a write to every single API
 *    call in the product.
 */

const THROTTLE_MS = 5 * 60_000;

/** In-process memo of the last write per user, to skip the read entirely. */
const lastWrite = new Map<string, number>();

/** Fire-and-forget. Never awaited by callers, never throws. */
export function touchActivity(req: Request, userId: string): void {
  void recordActivity(req, userId).catch((err) => {
    console.error("[activity] failed to record", err);
  });
}

async function recordActivity(req: Request, userId: string): Promise<void> {
  const ctx = requestContext(req);

  // Serverless resets this map per cold start, so it is an optimization, not
  // the throttle itself — the upsert below is idempotent regardless.
  const now = Date.now();
  const seen = lastWrite.get(userId);
  if (seen && now - seen < THROTTLE_MS) return;
  lastWrite.set(userId, now);

  await ensureActivitySchema();

  const ip = ctx.ip ?? "";
  const ua = ctx.userAgent ?? "";

  await prisma.userSession.upsert({
    where: { userId_ipAddress_userAgent: { userId, ipAddress: ip, userAgent: ua } },
    create: {
      userId,
      ipAddress: ip,
      userAgent: ua,
      device: ctx.device,
      platform: ctx.platform,
    },
    update: { lastSeenAt: new Date(), hitCount: { increment: 1 } },
  });

  // Denormalized onto the user so the admin list can show last-seen without a
  // join per row.
  await prisma.user.update({
    where: { id: userId },
    data: {
      lastSeenAt: new Date(),
      lastIp: ctx.ip,
      lastDevice: ctx.device,
      lastAction: ctx.path,
    },
  });
}

/**
 * Create the activity schema if absent. Migrations are not applied on deploy in
 * this project (see ensureCards, ensureRetentionSchema), so it runs lazily and
 * idempotently.
 */
let ensured: Promise<void> | null = null;

export function ensureActivitySchema(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      for (const col of [
        `last_seen_at TIMESTAMP`,
        `last_ip TEXT`,
        `last_device TEXT`,
        `last_action TEXT`,
      ]) {
        await prisma.$executeRawUnsafe(
          `ALTER TABLE app_users ADD COLUMN IF NOT EXISTS ${col}`
        );
      }
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS user_sessions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
          ip_address TEXT NOT NULL DEFAULT '',
          user_agent TEXT NOT NULL DEFAULT '',
          device TEXT,
          platform TEXT NOT NULL DEFAULT 'unknown',
          hit_count INTEGER NOT NULL DEFAULT 1,
          first_seen_at TIMESTAMP NOT NULL DEFAULT now(),
          last_seen_at TIMESTAMP NOT NULL DEFAULT now()
        )`);
      await prisma.$executeRawUnsafe(
        `CREATE UNIQUE INDEX IF NOT EXISTS user_sessions_identity_key
         ON user_sessions (user_id, ip_address, user_agent)`
      );
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS user_sessions_user_idx ON user_sessions (user_id)`
      );
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS user_sessions_last_seen_idx ON user_sessions (last_seen_at)`
      );
    })().catch((err) => {
      ensured = null; // allow retry
      throw err;
    });
  }
  return ensured;
}
