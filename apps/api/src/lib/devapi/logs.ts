import { prisma } from "@cheqpay/db";
import { toPublicId } from "@cheqpay/devapi";
import { ensureDevApiSchema } from "./ensureDevApi";
import type { Mode } from "./types";

interface LogRow {
  id: string;
  key_id: string | null;
  mode: Mode;
  method: string;
  path: string;
  status: number;
  duration_ms: number;
  error_code: string | null;
  auth_failure: string | null;
  ip: string | null;
  user_agent: string | null;
  idempotency_key: string | null;
  request_body: Record<string, unknown> | null;
  created_at: Date;
}

/** The developer's request log, newest first. Bodies were redacted when written. */
export async function listRequestLogs(accountId: string, mode: Mode, opts: { errorsOnly: boolean; limit: number }) {
  await ensureDevApiSchema();
  const rows = await prisma.$queryRawUnsafe<LogRow[]>(
    `SELECT * FROM dev_request_logs WHERE account_id = $1::uuid AND mode = $2 AND ($3::boolean = false OR status >= 400)
      ORDER BY created_at DESC LIMIT $4`,
    accountId,
    mode,
    opts.errorsOnly,
    Math.min(Math.max(opts.limit, 1), 200),
  );
  return rows.map((r) => ({
    id: toPublicId("request", r.id),
    key_id: r.key_id ? toPublicId("key", r.key_id) : null,
    mode: r.mode,
    method: r.method,
    path: r.path,
    status: r.status,
    duration_ms: r.duration_ms,
    error_code: r.error_code,
    // Only the owner sees why a key was refused; the API itself always says invalid_api_key.
    auth_failure: r.auth_failure,
    ip: r.ip,
    user_agent: r.user_agent,
    idempotency_key: r.idempotency_key,
    request_body: r.request_body,
    created_at: r.created_at.toISOString(),
  }));
}

/** Drop request logs older than 30 days, used idempotency keys older than 30 days and stale auth counters. */
export async function pruneDevLogs(): Promise<{ logs: number; idempotency: number; authFailures: number }> {
  await ensureDevApiSchema();
  const logs = await prisma.$executeRawUnsafe(`DELETE FROM dev_request_logs WHERE created_at < now() - interval '30 days'`);
  const idempotency = await prisma.$executeRawUnsafe(`DELETE FROM dev_idempotency_keys WHERE created_at < now() - interval '30 days'`);
  const authFailures = await prisma.$executeRawUnsafe(
    `DELETE FROM dev_auth_failures WHERE window_start < now() - interval '1 day' AND (blocked_until IS NULL OR blocked_until < now())`,
  );
  return { logs, idempotency, authFailures };
}
