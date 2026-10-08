// apps/api/src/lib/devapi/events.ts
//
// The event log: one row per thing that happened (a customer verified, a
// deposit credited...), kept for 30 days and readable from GET /v1/events.
//
// recordEvent runs inside the same database transaction as the change it
// describes, and writes the webhook deliveries for it there too. So a change
// that commits always has its notification queued, and a change that rolls
// back never sends one.

import { randomUUID } from "node:crypto";
import { prisma, type Prisma } from "@cheqpay/db";
import { fromPublicId, isEventType, toPublicId, type EventType } from "@cheqpay/devapi";
import { V1Error } from "./handler";
import { listParams, type Page, type Scope } from "./lists";
import type { EventRow, Mode } from "./types";

const toJson = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? Number(x) : x));

export async function recordEvent(
  db: Prisma.TransactionClient,
  e: { accountId: string; mode: Mode; type: EventType; object: unknown },
): Promise<string> {
  const id = randomUUID();
  await db.$executeRawUnsafe(
    `INSERT INTO dev_events (id, account_id, mode, type, data) VALUES ($1::uuid, $2::uuid, $3, $4, $5::jsonb)`,
    id,
    e.accountId,
    e.mode,
    e.type,
    toJson({ object: e.object }),
  );
  // The dashboard's test ping goes only to the endpoint being tested.
  if (e.type !== "ping") {
    await db.$executeRawUnsafe(
      `INSERT INTO dev_webhook_deliveries (id, event_id, endpoint_id, account_id, status, next_attempt_at)
       SELECT gen_random_uuid(), $1::uuid, w.id, w.account_id, 'pending', now()
         FROM dev_webhook_endpoints w
        WHERE w.account_id = $2::uuid AND w.mode = $3 AND w.status = 'enabled'
          AND ('*' = ANY(w.events) OR $4 = ANY(w.events))`,
      id,
      e.accountId,
      e.mode,
      e.type,
    );
  }
  return id;
}

export function eventObject(e: EventRow) {
  return {
    object: "event",
    id: toPublicId("event", e.id),
    type: e.type,
    data: e.data,
    livemode: e.mode === "live",
    created_at: e.created_at.toISOString(),
  };
}

export async function getEvent(scope: Scope, id: string): Promise<EventRow | null> {
  const rows = await prisma.$queryRawUnsafe<EventRow[]>(
    `SELECT * FROM dev_events WHERE id = $1::uuid AND account_id = $2::uuid AND mode = $3`,
    id,
    scope.accountId,
    scope.mode,
  );
  return rows[0] ?? null;
}

export async function loadEvent(id: string): Promise<EventRow | null> {
  const rows = await prisma.$queryRawUnsafe<EventRow[]>(`SELECT * FROM dev_events WHERE id = $1::uuid`, id);
  return rows[0] ?? null;
}

export async function listEvents(scope: Scope, q: URLSearchParams): Promise<Page<EventRow>> {
  const { limit, startingAfter } = listParams(q);
  const type = q.get("type");
  if (type !== null && !isEventType(type)) throw new V1Error(400, "type must be an event type, e.g. deposit.received.", "validation_error", "type");
  const after = startingAfter ? fromPublicId("event", startingAfter) : null;
  if (startingAfter && !after) throw new V1Error(400, "starting_after must be an event id.", "validation_error", "starting_after");
  const rows = await prisma.$queryRawUnsafe<EventRow[]>(
    `SELECT * FROM dev_events e
      WHERE e.account_id = $1::uuid AND e.mode = $2
        AND ($3::text IS NULL OR e.type = $3)
        AND ($4::uuid IS NULL OR (e.created_at, e.id) < (SELECT c.created_at, c.id FROM dev_events c
              WHERE c.id = $4::uuid AND c.account_id = $1::uuid AND c.mode = $2))
      ORDER BY e.created_at DESC, e.id DESC
      LIMIT $5`,
    scope.accountId,
    scope.mode,
    type,
    after,
    limit + 1,
  );
  return { object: "list", data: rows.slice(0, limit), has_more: rows.length > limit };
}

/** Events (and, through the cascade, their deliveries) older than 30 days. */
export async function pruneEvents(): Promise<number> {
  return prisma.$executeRawUnsafe(`DELETE FROM dev_events WHERE created_at < now() - interval '30 days'`);
}
