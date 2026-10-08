// apps/api/src/lib/devapi/idempotency.ts
//
// Idempotency for POST requests. A client retrying after a timeout sends the
// same Idempotency-Key; it must get the first request's result, never a second
// payment. And a key reused for a DIFFERENT request is a client bug that must
// fail loudly (409), not quietly return the wrong object.
//
//   claim     before any work: insert (account, mode, key, body hash). If the
//             key exists with another body hash → 409 idempotency_key_reused;
//             with the same hash and a result → replay it; still running → 409.
//   complete  INSIDE the handler's money transaction, record what the request
//             created. The record and the money then commit together, so there
//             is no moment where money moved but the key doesn't say so.
//   release   if the handler failed before doing anything, free the key so the
//             client can retry with it.

import { createHash } from "node:crypto";
import { prisma, type Prisma } from "@cheqpay/db";
import { ApiError } from "../http";
import { ensureDevApiSchema } from "./ensureDevApi";
import type { Mode } from "./types";

export const IDEMPOTENCY_KEY = /^[A-Za-z0-9_\-:.]{1,255}$/;

/** A stable hash of a request: the route plus the body with object keys sorted. */
export function requestHash(route: string, body: unknown): string {
  return createHash("sha256").update(`${route}\n${canonicalJson(body)}`).digest("hex");
}

export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`).join(",")}}`;
}

export type ClaimResult =
  | { state: "fresh" }
  | { state: "replay"; resourceType: string | null; resourceId: string | null; statusCode: number | null };

export async function claimIdempotencyKey(
  scope: { accountId: string; mode: Mode },
  key: string,
  hash: string,
  route: string,
): Promise<ClaimResult> {
  if (!IDEMPOTENCY_KEY.test(key) || key.startsWith("cp:")) {
    throw new ApiError(400, "Send a unique Idempotency-Key header (letters, digits, - _ : . up to 255 characters).", "idempotency_key_required");
  }
  await ensureDevApiSchema();
  const inserted = await prisma.$queryRawUnsafe<{ key: string }[]>(
    `INSERT INTO dev_idempotency_keys (account_id, mode, key, request_hash, route) VALUES ($1::uuid, $2, $3, $4, $5)
     ON CONFLICT DO NOTHING RETURNING key`,
    scope.accountId,
    scope.mode,
    key,
    hash,
    route,
  );
  if (inserted.length) return { state: "fresh" };

  const rows = await prisma.$queryRawUnsafe<
    { request_hash: string; resource_type: string | null; resource_id: string | null; status_code: number | null }[]
  >(
    `SELECT request_hash, resource_type, resource_id, status_code FROM dev_idempotency_keys
      WHERE account_id = $1::uuid AND mode = $2 AND key = $3`,
    scope.accountId,
    scope.mode,
    key,
  );
  const row = rows[0];
  if (!row) return claimIdempotencyKey(scope, key, hash, route); // released between the two statements
  if (row.request_hash !== hash) {
    throw new ApiError(409, "This Idempotency-Key was already used with a different request.", "idempotency_key_reused");
  }
  if (row.status_code === null) {
    throw new ApiError(409, "A request with this Idempotency-Key is still being processed. Retry shortly.", "idempotency_in_progress");
  }
  return { state: "replay", resourceType: row.resource_type, resourceId: row.resource_id, statusCode: row.status_code };
}

/** Record the request's result. Call inside the same DB transaction that moved the money. */
export async function completeIdempotencyKey(
  db: Prisma.TransactionClient | typeof prisma,
  scope: { accountId: string; mode: Mode },
  key: string,
  result: { resourceType: string; resourceId: string | null; statusCode: number },
): Promise<void> {
  await db.$executeRawUnsafe(
    `UPDATE dev_idempotency_keys SET resource_type = $4, resource_id = $5::uuid, status_code = $6
      WHERE account_id = $1::uuid AND mode = $2 AND key = $3`,
    scope.accountId,
    scope.mode,
    key,
    result.resourceType,
    result.resourceId,
    result.statusCode,
  );
}

/** Free a key whose request failed before doing anything, so the client may retry with it. */
export async function releaseIdempotencyKey(scope: { accountId: string; mode: Mode }, key: string): Promise<void> {
  await prisma.$executeRawUnsafe(
    `DELETE FROM dev_idempotency_keys WHERE account_id = $1::uuid AND mode = $2 AND key = $3 AND status_code IS NULL`,
    scope.accountId,
    scope.mode,
    key,
  );
}
