// apps/api/src/lib/devapi/jobs.ts
//
// Work that can't wait for the daily cron: webhook retries and verifications
// that have come due. Run at most once a minute, from API traffic (after the
// response), on whichever instance takes the lease first. On a quiet day the
// daily cron still sweeps everything.

import { prisma } from "@cheqpay/db";
import { ensureDevApiSchema } from "./ensureDevApi";
import { sweepDueDeliveries } from "./webhooks";
import { retryDueVerifications } from "./customers";

let lastTried = 0;

export async function maybeRunJobs(): Promise<void> {
  if (Date.now() - lastTried < 60_000) return;
  lastTried = Date.now();
  await ensureDevApiSchema();
  const lease = await prisma.$queryRawUnsafe<{ name: string }[]>(
    `INSERT INTO dev_job_locks (name, locked_until) VALUES ('minute_sweep', now() + interval '55 seconds')
     ON CONFLICT (name) DO UPDATE SET locked_until = EXCLUDED.locked_until WHERE dev_job_locks.locked_until < now()
     RETURNING name`,
  );
  if (!lease.length) return;
  await sweepDueDeliveries({ limit: 100, budgetMs: 20_000 });
  await retryDueVerifications(10);
}

/** Test hook. */
export function __resetJobThrottle(): void {
  lastTried = 0;
}
