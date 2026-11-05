// apps/api/src/lib/cronAuth.ts
//
// Who may run a scheduled job. Vercel Cron sends `Authorization: Bearer
// <CRON_SECRET>` when the secret is set on the project. Header only — a secret
// in the query string ends up in logs. In production a job never runs
// unauthenticated: with no secret configured it is simply disabled.

import { timingSafeEqual } from "node:crypto";
import { getEnv } from "./env";
import { jsonOk } from "./http";

export function bearerMatches(header: string | null, secret: string): boolean {
  const a = Buffer.from(header ?? "");
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Null when the caller may run the job; otherwise the response to return. */
export function cronRefusal(req: Request): Response | null {
  const { CRON_SECRET } = getEnv();
  if (!CRON_SECRET) {
    if (process.env.NODE_ENV === "production") {
      return jsonOk({ error: "Cron is not configured", code: "cron_disabled" }, 503);
    }
    return null;
  }
  if (!bearerMatches(req.headers.get("authorization"), CRON_SECRET)) {
    return jsonOk({ error: "Unauthorized", code: "unauthorized" }, 401);
  }
  return null;
}

/**
 * For jobs the database scheduler (pg_cron + pg_net) calls every minute: the
 * scheduler's own secret (DB_CRON_SECRET, or the older SOCIAL_CRON_SECRET) is
 * accepted as well as CRON_SECRET, so CRON_SECRET never has to be copied into
 * the database. Null when the caller may run the job.
 */
export function schedulerRefusal(req: Request): Response | null {
  const { DB_CRON_SECRET, SOCIAL_CRON_SECRET } = getEnv();
  const header = req.headers.get("authorization");
  for (const secret of [DB_CRON_SECRET, SOCIAL_CRON_SECRET]) {
    if (secret && bearerMatches(header, secret)) return null;
  }
  return cronRefusal(req);
}
