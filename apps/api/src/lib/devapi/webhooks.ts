// apps/api/src/lib/devapi/webhooks.ts
//
// Webhook endpoints, signing and delivery.
//
// Signing follows the open Standard Webhooks format, so developers can verify
// with our snippets or any Standard Webhooks library:
//
//   webhook-id         the event id (the same on every retry: dedupe on it)
//   webhook-timestamp  Unix seconds when this attempt was sent
//   webhook-signature  "v1,<base64 HMAC-SHA256(secret, id.timestamp.body)>",
//                      where the key is the base64 part of the whsec_ secret.
//                      While a rolled secret's old value is still valid (24h)
//                      both signatures are sent, space-separated.
//
// Delivery: every event's deliveries are written with the event (events.ts)
// and attempted straight after the response; failures retry on the schedule
// in @cheqpay/devapi (1 minute out to 24 hours), driven by a sweep that runs
// at most once a minute on API traffic, by the daily cron, and by "Resend" in
// the dashboard. An endpoint that has failed for three days is switched off
// and its owner emailed.

import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { prisma } from "@cheqpay/db";
import { z } from "zod";
import { SUBSCRIBABLE_EVENT_TYPES, WEBHOOK_RETRY_SCHEDULE_SECONDS, WEBHOOK_TOLERANCE_SECONDS, toPublicId } from "@cheqpay/devapi";
import { ApiError } from "../http";
import { decryptPii, encryptPii } from "../pii";
import { checkRateLimit } from "../ratelimit";
import { ensureDevApiSchema } from "./ensureDevApi";
import { eventObject, loadEvent, recordEvent } from "./events";
import { safePostJson, webhookUrlProblem, type PostResult } from "./safeHttp";
import { alertOwner, later, recordDevAudit } from "./audit";
import { scrubSensitive } from "./redact";
import { assertPiiReady } from "./files";
import type { DevPlan } from "./plans";
import type { AccountRow, DeliveryRow, EndpointRow, Mode } from "./types";

// ---- Signing --------------------------------------------------------------

export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(32).toString("base64")}`;
}

export function signWebhook(secret: string, msgId: string, timestamp: number, body: string): string {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  return `v1,${createHmac("sha256", key).update(`${msgId}.${timestamp}.${body}`).digest("base64")}`;
}

/**
 * Verify a delivery the way a developer's server should: a recent timestamp,
 * then a constant-time comparison against every signature sent. (The docs carry
 * the same logic in Node, Python and PHP; the tests prove they agree.)
 */
export function verifyWebhookSignature(
  secret: string,
  headers: { id: string; timestamp: string; signature: string },
  body: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  const ts = Number(headers.timestamp);
  if (!Number.isInteger(ts) || Math.abs(nowSeconds - ts) > WEBHOOK_TOLERANCE_SECONDS) return false;
  const expected = Buffer.from(signWebhook(secret, headers.id, ts, body).slice(3), "base64");
  for (const part of headers.signature.split(" ")) {
    const [version, sig] = part.split(",");
    if (version !== "v1" || !sig) continue;
    const got = Buffer.from(sig, "base64");
    if (got.length === expected.length && timingSafeEqual(got, expected)) return true;
  }
  return false;
}

// ---- Endpoints ------------------------------------------------------------

const eventsSchema = z
  .array(z.string())
  .min(1, "Choose at least one event, or \"*\" for all")
  .max(50)
  .transform((list, ctx) => {
    const unique = [...new Set(list)];
    for (const e of unique) {
      if (e !== "*" && !(SUBSCRIBABLE_EVENT_TYPES as readonly string[]).includes(e)) {
        ctx.addIssue({ code: "custom", message: `Unknown event type: ${e.slice(0, 60)}` });
        return z.NEVER;
      }
    }
    return unique.includes("*") ? ["*"] : unique;
  });

export const endpointCreateSchema = z
  .object({
    mode: z.enum(["test", "live"]),
    url: z.string().max(2048),
    events: eventsSchema.default(["*"]),
    description: z.string().trim().max(100).optional(),
  })
  .strict();

export const endpointUpdateSchema = z
  .object({
    url: z.string().max(2048).optional(),
    events: eventsSchema.optional(),
    description: z.string().trim().max(100).nullable().optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

function assertUrl(url: string): void {
  const problem = webhookUrlProblem(url);
  if (problem) throw new ApiError(400, `The webhook URL ${problem}.`, "invalid_url");
}

export function endpointView(e: EndpointRow, now: Date = new Date()) {
  return {
    id: toPublicId("webhook_endpoint", e.id),
    mode: e.mode,
    url: e.url,
    description: e.description,
    events: e.events,
    status: e.status,
    disabled_reason: e.disabled_reason,
    failing_since: e.failing_since?.toISOString() ?? null,
    previous_secret_valid_until:
      e.previous_secret_expires_at && e.previous_secret_expires_at > now ? e.previous_secret_expires_at.toISOString() : null,
    created_at: e.created_at.toISOString(),
    updated_at: e.updated_at.toISOString(),
  };
}

export async function listEndpoints(accountId: string, mode: Mode | null): Promise<EndpointRow[]> {
  await ensureDevApiSchema();
  return prisma.$queryRawUnsafe<EndpointRow[]>(
    `SELECT * FROM dev_webhook_endpoints WHERE account_id = $1::uuid AND ($2::text IS NULL OR mode = $2) ORDER BY created_at`,
    accountId,
    mode,
  );
}

export async function getEndpoint(accountId: string, id: string): Promise<EndpointRow | null> {
  await ensureDevApiSchema();
  const rows = await prisma.$queryRawUnsafe<EndpointRow[]>(
    `SELECT * FROM dev_webhook_endpoints WHERE id = $1::uuid AND account_id = $2::uuid`,
    id,
    accountId,
  );
  return rows[0] ?? null;
}

interface Actor {
  userId: string;
  ip: string | null;
  userAgent: string | null;
}

export async function createEndpoint(
  account: AccountRow,
  plan: DevPlan,
  input: z.infer<typeof endpointCreateSchema>,
  actor: Actor,
): Promise<{ endpoint: EndpointRow; secret: string }> {
  assertPiiReady();
  assertUrl(input.url);
  await ensureDevApiSchema();
  const existing = await listEndpoints(account.id, input.mode);
  if (existing.length >= plan.webhookEndpoints) {
    throw new ApiError(403, `Your plan allows ${plan.webhookEndpoints} webhook endpoints per mode.`, "plan_limit_reached");
  }
  const secret = generateWebhookSecret();
  const id = randomUUID();
  const rows = await prisma.$queryRawUnsafe<EndpointRow[]>(
    `INSERT INTO dev_webhook_endpoints (id, account_id, mode, url, description, events, secret_enc)
     VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::text[], $7) RETURNING *`,
    id,
    account.id,
    input.mode,
    input.url,
    input.description ?? null,
    input.events,
    encryptPii(secret),
  );
  await recordDevAudit({
    accountId: account.id,
    actor: "owner",
    action: "webhook.created",
    target: toPublicId("webhook_endpoint", id),
    details: { mode: input.mode, url: input.url, events: input.events },
    ip: actor.ip,
    userAgent: actor.userAgent,
  });
  alertOwner(account, {
    title: "A webhook endpoint was added",
    body: `CheqPay will now send your ${input.mode} events to ${input.url}.`,
    details: [{ label: "IP address", value: actor.ip ?? "unknown" }],
  });
  return { endpoint: rows[0], secret };
}

export async function updateEndpoint(
  account: AccountRow,
  endpoint: EndpointRow,
  patch: z.infer<typeof endpointUpdateSchema>,
  actor: Actor,
): Promise<EndpointRow> {
  if (patch.url !== undefined) assertUrl(patch.url);
  const enable = patch.enabled === true;
  const rows = await prisma.$queryRawUnsafe<EndpointRow[]>(
    `UPDATE dev_webhook_endpoints SET
        url = COALESCE($3, url),
        events = COALESCE($4::text[], events),
        description = CASE WHEN $5 THEN $6 ELSE description END,
        status = CASE WHEN $7::boolean IS NULL THEN status WHEN $7 THEN 'enabled' ELSE 'disabled' END,
        disabled_reason = CASE WHEN $7::boolean IS NULL THEN disabled_reason WHEN $7 THEN NULL ELSE 'disabled by you' END,
        failing_since = CASE WHEN $8 THEN NULL ELSE failing_since END,
        updated_at = now()
      WHERE id = $1::uuid AND account_id = $2::uuid RETURNING *`,
    endpoint.id,
    account.id,
    patch.url ?? null,
    patch.events ?? null,
    patch.description !== undefined,
    patch.description ?? null,
    patch.enabled ?? null,
    enable,
  );
  await recordDevAudit({
    accountId: account.id,
    actor: "owner",
    action: "webhook.updated",
    target: toPublicId("webhook_endpoint", endpoint.id),
    details: { url_changed: patch.url !== undefined && patch.url !== endpoint.url, events: patch.events, enabled: patch.enabled },
    ip: actor.ip,
    userAgent: actor.userAgent,
  });
  if (patch.url !== undefined && patch.url !== endpoint.url) {
    alertOwner(account, {
      title: "A webhook URL was changed",
      body: `Your ${endpoint.mode} events now go to ${patch.url} instead of ${endpoint.url}.`,
      details: [{ label: "IP address", value: actor.ip ?? "unknown" }],
    });
  }
  return rows[0];
}

export async function deleteEndpoint(account: AccountRow, endpoint: EndpointRow, actor: Actor): Promise<void> {
  await prisma.$executeRawUnsafe(`DELETE FROM dev_webhook_endpoints WHERE id = $1::uuid AND account_id = $2::uuid`, endpoint.id, account.id);
  await recordDevAudit({
    accountId: account.id,
    actor: "owner",
    action: "webhook.deleted",
    target: toPublicId("webhook_endpoint", endpoint.id),
    details: { mode: endpoint.mode, url: endpoint.url },
    ip: actor.ip,
    userAgent: actor.userAgent,
  });
}

/** A new signing secret; the old one keeps signing alongside it for 24 hours. */
export async function rollEndpointSecret(account: AccountRow, endpoint: EndpointRow, actor: Actor): Promise<{ endpoint: EndpointRow; secret: string }> {
  assertPiiReady();
  const secret = generateWebhookSecret();
  const rows = await prisma.$queryRawUnsafe<EndpointRow[]>(
    `UPDATE dev_webhook_endpoints SET previous_secret_enc = secret_enc, previous_secret_expires_at = now() + interval '24 hours',
        secret_enc = $3, updated_at = now()
      WHERE id = $1::uuid AND account_id = $2::uuid RETURNING *`,
    endpoint.id,
    account.id,
    encryptPii(secret),
  );
  await recordDevAudit({
    accountId: account.id,
    actor: "owner",
    action: "webhook.secret_rolled",
    target: toPublicId("webhook_endpoint", endpoint.id),
    ip: actor.ip,
    userAgent: actor.userAgent,
  });
  alertOwner(account, {
    title: "A webhook signing secret was rolled",
    body: `The signing secret for ${endpoint.url} was replaced. The old one stays valid for 24 hours.`,
    details: [{ label: "IP address", value: actor.ip ?? "unknown" }],
  });
  return { endpoint: rows[0], secret };
}

// ---- Delivery -------------------------------------------------------------

type Transport = (url: string, body: string, headers: Record<string, string>) => Promise<PostResult>;
const realTransport: Transport = (url, body, headers) => safePostJson(url, body, headers);
let transport: Transport = realTransport;

/** Tests swap the network for a recorder. Never used outside tests. */
export function __setWebhookTransportForTests(t: Transport | null): void {
  transport = t ?? realTransport;
}

const DISABLE_AFTER_MS = 3 * 86_400_000;
/** Deliveries per endpoint per minute; beyond it, deliveries wait a minute (not counted as failures). */
const PER_ENDPOINT_PER_MINUTE = 600;

export interface DeliveryView {
  id: string;
  event_id: string;
  event_type: string;
  endpoint_id: string;
  status: DeliveryRow["status"];
  attempts: number;
  next_attempt_at: string | null;
  last_status_code: number | null;
  last_error: string | null;
  last_attempt_at: string | null;
  delivered_at: string | null;
  created_at: string;
}

export function deliveryView(d: DeliveryRow & { event_type?: string }): DeliveryView {
  return {
    id: toPublicId("delivery", d.id),
    event_id: toPublicId("event", d.event_id),
    event_type: d.event_type ?? "",
    endpoint_id: toPublicId("webhook_endpoint", d.endpoint_id),
    status: d.status,
    attempts: d.attempts,
    next_attempt_at: d.status === "pending" ? d.next_attempt_at?.toISOString() ?? null : null,
    last_status_code: d.last_status_code,
    last_error: d.last_error,
    last_attempt_at: d.last_attempt_at?.toISOString() ?? null,
    delivered_at: d.delivered_at?.toISOString() ?? null,
    created_at: d.created_at.toISOString(),
  };
}

export async function listDeliveries(accountId: string, endpointId: string, limit = 50): Promise<DeliveryView[]> {
  const rows = await prisma.$queryRawUnsafe<(DeliveryRow & { event_type: string })[]>(
    `SELECT d.*, e.type AS event_type FROM dev_webhook_deliveries d JOIN dev_events e ON e.id = d.event_id
      WHERE d.account_id = $1::uuid AND d.endpoint_id = $2::uuid ORDER BY d.created_at DESC LIMIT $3`,
    accountId,
    endpointId,
    Math.min(Math.max(limit, 1), 100),
  );
  return rows.map(deliveryView);
}

/**
 * Try one delivery now. Takes a 30-second lease first, so two sweeps (or a
 * sweep and a Resend) can't send the same delivery twice at once.
 */
export async function attemptDelivery(deliveryId: string, opts: { force?: boolean } = {}): Promise<DeliveryRow | null> {
  const claimed = await prisma.$queryRawUnsafe<DeliveryRow[]>(
    `UPDATE dev_webhook_deliveries SET locked_until = now() + interval '30 seconds'
      WHERE id = $1::uuid AND status = 'pending' AND (locked_until IS NULL OR locked_until < now())
        AND ($2 OR next_attempt_at IS NULL OR next_attempt_at <= now())
      RETURNING *`,
    deliveryId,
    opts.force === true,
  );
  const d = claimed[0];
  if (!d) return null;

  const [event, endpointRows] = await Promise.all([
    loadEvent(d.event_id),
    prisma.$queryRawUnsafe<EndpointRow[]>(`SELECT * FROM dev_webhook_endpoints WHERE id = $1::uuid`, d.endpoint_id),
  ]);
  const endpoint = endpointRows[0];
  if (!event || !endpoint || endpoint.status !== "enabled") {
    return finishDelivery(d, { ok: false, status: null, error: "the endpoint is disabled", final: true });
  }

  const pace = await checkRateLimit(`devapi:wh:${endpoint.id}`, PER_ENDPOINT_PER_MINUTE, 60_000);
  if (!pace.allowed) {
    const rows = await prisma.$queryRawUnsafe<DeliveryRow[]>(
      `UPDATE dev_webhook_deliveries SET locked_until = NULL, next_attempt_at = now() + interval '1 minute' WHERE id = $1::uuid RETURNING *`,
      d.id,
    );
    return rows[0];
  }

  const body = JSON.stringify(eventObject(event));
  const msgId = toPublicId("event", event.id);
  const timestamp = Math.floor(Date.now() / 1000);
  const signatures = [signWebhook(decryptPii(endpoint.secret_enc), msgId, timestamp, body)];
  if (endpoint.previous_secret_enc && endpoint.previous_secret_expires_at && endpoint.previous_secret_expires_at > new Date()) {
    signatures.push(signWebhook(decryptPii(endpoint.previous_secret_enc), msgId, timestamp, body));
  }

  try {
    const res = await transport(endpoint.url, body, {
      "webhook-id": msgId,
      "webhook-timestamp": String(timestamp),
      "webhook-signature": signatures.join(" "),
    });
    const ok = res.status >= 200 && res.status < 300;
    return finishDelivery(d, { ok, status: res.status, error: ok ? null : `HTTP ${res.status}`, endpoint });
  } catch (err) {
    return finishDelivery(d, { ok: false, status: null, error: err instanceof Error ? err.message : String(err), endpoint });
  }
}

async function finishDelivery(
  d: DeliveryRow,
  r: { ok: boolean; status: number | null; error: string | null; endpoint?: EndpointRow; final?: boolean },
): Promise<DeliveryRow> {
  const attempts = d.attempts + 1;
  const delay = WEBHOOK_RETRY_SCHEDULE_SECONDS[attempts - 1];
  const status = r.ok ? "succeeded" : r.final || delay === undefined ? "failed" : "pending";
  const rows = await prisma.$queryRawUnsafe<DeliveryRow[]>(
    `UPDATE dev_webhook_deliveries SET status = $2, attempts = $3, last_status_code = $4, last_error = $5,
        last_attempt_at = now(), locked_until = NULL,
        next_attempt_at = CASE WHEN $2 = 'pending' THEN now() + make_interval(secs => $6::int) ELSE NULL END,
        delivered_at = CASE WHEN $2 = 'succeeded' THEN now() ELSE delivered_at END
      WHERE id = $1::uuid RETURNING *`,
    d.id,
    status,
    attempts,
    r.status,
    r.error ? scrubSensitive(r.error).slice(0, 300) : null,
    delay ?? 0,
  );
  if (r.endpoint) await noteEndpointHealth(r.endpoint, r.ok);
  return rows[0];
}

/** Track an endpoint's failing streak; switch it off (and tell the owner) after three days of nothing but failures. */
async function noteEndpointHealth(endpoint: EndpointRow, ok: boolean): Promise<void> {
  if (ok) {
    if (endpoint.failing_since) {
      await prisma.$executeRawUnsafe(`UPDATE dev_webhook_endpoints SET failing_since = NULL WHERE id = $1::uuid`, endpoint.id);
    }
    return;
  }
  const rows = await prisma.$queryRawUnsafe<{ failing_since: Date }[]>(
    `UPDATE dev_webhook_endpoints SET failing_since = COALESCE(failing_since, now()) WHERE id = $1::uuid RETURNING failing_since`,
    endpoint.id,
  );
  const since = rows[0]?.failing_since;
  if (!since || Date.now() - since.getTime() < DISABLE_AFTER_MS) return;
  const disabled = await prisma.$executeRawUnsafe(
    `UPDATE dev_webhook_endpoints SET status = 'disabled', disabled_reason = 'failing for 3 days', updated_at = now()
      WHERE id = $1::uuid AND status = 'enabled'`,
    endpoint.id,
  );
  if (disabled) {
    const owner = await prisma.$queryRawUnsafe<AccountRow[]>(`SELECT * FROM dev_accounts WHERE id = $1::uuid`, endpoint.account_id);
    if (owner[0]) {
      alertOwner(owner[0], {
        title: "A webhook endpoint was switched off",
        body: `Every delivery to ${endpoint.url} has failed for three days, so we stopped sending to it. Fix the endpoint, switch it back on in your dashboard, and resend what it missed. Events are also readable from GET /v1/events.`,
      });
    }
  }
}

/** Attempt the deliveries of freshly recorded events, after the response. */
export function deliverSoon(eventIds: string[]): void {
  if (eventIds.length === 0) return;
  later(async () => {
    const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM dev_webhook_deliveries WHERE event_id = ANY($1::uuid[]) AND status = 'pending'`,
      eventIds,
    );
    for (const r of rows) await attemptDelivery(r.id);
  });
}

/** Retry whatever is due, within a time budget. */
export async function sweepDueDeliveries(opts: { limit?: number; budgetMs?: number } = {}): Promise<{ attempted: number; succeeded: number }> {
  await ensureDevApiSchema();
  const started = Date.now();
  const due = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `SELECT id FROM dev_webhook_deliveries
      WHERE status = 'pending' AND next_attempt_at <= now() AND (locked_until IS NULL OR locked_until < now())
      ORDER BY next_attempt_at LIMIT $1`,
    opts.limit ?? 200,
  );
  let attempted = 0;
  let succeeded = 0;
  const queue = [...due];
  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      if (Date.now() - started > (opts.budgetMs ?? 25_000)) return;
      const r = await attemptDelivery(next.id).catch(() => null);
      if (r) {
        attempted++;
        if (r.status === "succeeded") succeeded++;
      }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return { attempted, succeeded };
}

/** Dashboard "Resend": one more attempt now, whatever state the delivery is in. */
export async function resendDelivery(accountId: string, deliveryId: string): Promise<DeliveryView | null> {
  const reset = await prisma.$executeRawUnsafe(
    `UPDATE dev_webhook_deliveries SET status = 'pending', next_attempt_at = now(), locked_until = NULL
      WHERE id = $1::uuid AND account_id = $2::uuid`,
    deliveryId,
    accountId,
  );
  if (!reset) return null;
  await attemptDelivery(deliveryId, { force: true });
  const rows = await prisma.$queryRawUnsafe<(DeliveryRow & { event_type: string })[]>(
    `SELECT d.*, e.type AS event_type FROM dev_webhook_deliveries d JOIN dev_events e ON e.id = d.event_id WHERE d.id = $1::uuid`,
    deliveryId,
  );
  return rows[0] ? deliveryView(rows[0]) : null;
}

/** Dashboard "Send test event": a `ping` to one endpoint, delivered right away. */
export async function sendTestEvent(account: AccountRow, endpoint: EndpointRow): Promise<DeliveryView | null> {
  const deliveryId = randomUUID();
  await prisma.$transaction(async (db) => {
    const eventId = await recordEvent(db, {
      accountId: account.id,
      mode: endpoint.mode,
      type: "ping",
      object: { object: "ping", message: "Your webhook endpoint is reachable and verifying signatures." },
    });
    await db.$executeRawUnsafe(
      `INSERT INTO dev_webhook_deliveries (id, event_id, endpoint_id, account_id, status, next_attempt_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'pending', now())`,
      deliveryId,
      eventId,
      endpoint.id,
      account.id,
    );
  });
  // A test is a single attempt: it shouldn't keep retrying in the background.
  await attemptDelivery(deliveryId, { force: true });
  await prisma.$executeRawUnsafe(
    `UPDATE dev_webhook_deliveries SET status = 'failed', next_attempt_at = NULL WHERE id = $1::uuid AND status = 'pending'`,
    deliveryId,
  );
  const rows = await prisma.$queryRawUnsafe<(DeliveryRow & { event_type: string })[]>(
    `SELECT d.*, e.type AS event_type FROM dev_webhook_deliveries d JOIN dev_events e ON e.id = d.event_id WHERE d.id = $1::uuid`,
    deliveryId,
  );
  return rows[0] ? deliveryView(rows[0]) : null;
}
