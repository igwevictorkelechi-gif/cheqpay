// apps/api/src/lib/webPush.ts
//
// Browser push notifications (the Web Push standard, VAPID-signed).
//
// A browser that the user lets us notify gives us a subscription: an endpoint
// on its vendor's push service (Google, Mozilla, Apple) plus two keys. We keep
// those per user and, for every notification, encrypt the payload to the keys
// and POST it to the endpoint. The same per-category opt-ins as the mobile app
// apply, so one toggle silences a category everywhere.
//
// Off entirely until VAPID keys are configured. Never throws: a notification
// is a side effect and must not break the request that triggered it.

import { randomUUID } from "node:crypto";
import webpush from "web-push";
import { prisma } from "@cheqpay/db";
import { getEnv } from "./env";
import { type NotificationCategory, resolvePrefs } from "./notifications";

export interface WebPushMessage {
  title: string;
  body: string;
  category: NotificationCategory;
  /** A path on the site to open when the notification is tapped. */
  url?: string;
  data?: Record<string, unknown>;
  /** Set by the sender for a broadcast, so every browser reports on the same id. */
  id?: string;
}

/** What a send did: how many browsers the push services accepted it for, under which id. */
export interface WebPushResult {
  id: string;
  accepted: number;
}

interface SubscriptionRow {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

let tableReady: Promise<void> | null = null;
export function ensureWebPushTable(): Promise<void> {
  if (!tableReady) {
    tableReady = (async () => {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS web_push_subscriptions (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
          endpoint text NOT NULL UNIQUE,
          p256dh text NOT NULL,
          auth text NOT NULL,
          user_agent text,
          created_at timestamptz NOT NULL DEFAULT now(),
          last_success_at timestamptz
        )`);
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS web_push_subscriptions_user_idx ON web_push_subscriptions(user_id)`
      );
      // One row per notification sent, and one receipt per browser that
      // reported back. "Accepted" by Apple or Google only means the push
      // service took it; the receipts say whether the phone actually showed it.
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS web_push_messages (
          id uuid PRIMARY KEY,
          kind text NOT NULL,
          title text NOT NULL,
          accepted integer NOT NULL DEFAULT 0,
          created_at timestamptz NOT NULL DEFAULT now()
        )`);
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS web_push_receipts (
          message_id uuid NOT NULL REFERENCES web_push_messages(id) ON DELETE CASCADE,
          subscription_id uuid NOT NULL REFERENCES web_push_subscriptions(id) ON DELETE CASCADE,
          delivered_at timestamptz,
          opened_at timestamptz,
          PRIMARY KEY (message_id, subscription_id)
        )`);
    })().catch((err) => {
      tableReady = null;
      throw err;
    });
  }
  return tableReady;
}

/** The public key browsers subscribe with, or null when web push is off. */
export function webPushPublicKey(): string | null {
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = getEnv();
  return VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY ? VAPID_PUBLIC_KEY : null;
}

let configured = false;
function configure(): boolean {
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = getEnv();
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return false;
  if (!configured) {
    webpush.setVapidDetails(VAPID_SUBJECT || "mailto:support@mycheqpay.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    configured = true;
  }
  return true;
}

/** Save (or move to this user) a browser's subscription. */
export async function saveSubscription(
  userId: string,
  sub: { endpoint: string; keys: { p256dh: string; auth: string } },
  userAgent: string | null
): Promise<void> {
  await ensureWebPushTable();
  // One endpoint belongs to one browser profile. If someone else was signed in
  // on it before, it now notifies whoever subscribed last.
  await prisma.$executeRawUnsafe(
    `INSERT INTO web_push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
     VALUES ($1::uuid, $2, $3, $4, $5)
     ON CONFLICT (endpoint) DO UPDATE SET
       user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
       user_agent = EXCLUDED.user_agent`,
    userId,
    sub.endpoint,
    sub.keys.p256dh,
    sub.keys.auth,
    (userAgent ?? "").slice(0, 300)
  );
}

/** Remove a subscription — only the caller's own. */
export async function removeSubscription(userId: string, endpoint: string): Promise<number> {
  await ensureWebPushTable();
  return prisma.$executeRawUnsafe(
    `DELETE FROM web_push_subscriptions WHERE user_id = $1::uuid AND endpoint = $2`,
    userId,
    endpoint
  );
}

/**
 * Remove a subscription without a login, for a browser whose session has just
 * ended. It must prove it holds the subscription: the auth secret only that
 * browser and we know.
 */
export async function removeSubscriptionBySecret(endpoint: string, auth: string): Promise<number> {
  await ensureWebPushTable();
  return prisma.$executeRawUnsafe(
    `DELETE FROM web_push_subscriptions WHERE endpoint = $1 AND auth = $2`,
    endpoint,
    auth
  );
}

/** Where browsers report that a notification arrived or was tapped. */
function receiptUrl(): string | null {
  const explicit = process.env.PUBLIC_API_URL?.replace(/\/$/, "");
  if (explicit) return `${explicit}/api/push/web/receipt`;
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return vercel ? `https://${vercel}/api/push/web/receipt` : null;
}

function payload(msg: WebPushMessage, id: string): string {
  return JSON.stringify({
    id,
    title: msg.title,
    body: msg.body,
    url: msg.url ?? null,
    category: msg.category,
    data: msg.data ?? {},
    receipt: receiptUrl(),
  });
}

async function recordMessage(id: string, kind: string, title: string, accepted: number): Promise<void> {
  await prisma
    .$executeRawUnsafe(
      `INSERT INTO web_push_messages (id, kind, title, accepted) VALUES ($1::uuid, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET accepted = web_push_messages.accepted + EXCLUDED.accepted`,
      id,
      kind,
      title.slice(0, 200),
      accepted
    )
    .catch((err) => console.error("[webpush] record message", err));
}

/**
 * A browser reports that a notification arrived ("delivered") or was tapped
 * ("opened"). Only counts for a subscription and message we know. Returns
 * whether it was recorded.
 */
export async function recordReceipt(
  messageId: string,
  endpoint: string,
  event: "delivered" | "opened"
): Promise<boolean> {
  await ensureWebPushTable();
  const col = event === "opened" ? "opened_at" : "delivered_at";
  const n = await prisma.$executeRawUnsafe(
    `INSERT INTO web_push_receipts (message_id, subscription_id, ${col})
     SELECT m.id, s.id, now() FROM web_push_messages m, web_push_subscriptions s
      WHERE m.id = $1::uuid AND s.endpoint = $2
     ON CONFLICT (message_id, subscription_id) DO UPDATE SET ${col} = COALESCE(web_push_receipts.${col}, now())`,
    messageId,
    endpoint
  );
  return n > 0;
}

/** How a notification did: accepted by the push services, shown on a device, tapped. */
export async function messageStats(
  id: string
): Promise<{ id: string; title: string; accepted: number; delivered: number; opened: number } | null> {
  await ensureWebPushTable();
  const rows = await prisma.$queryRawUnsafe<
    { id: string; title: string; accepted: number; delivered: bigint; opened: bigint }[]
  >(
    `SELECT m.id::text, m.title, m.accepted,
            count(r.delivered_at) AS delivered, count(r.opened_at) AS opened
       FROM web_push_messages m LEFT JOIN web_push_receipts r ON r.message_id = m.id
      WHERE m.id = $1::uuid GROUP BY m.id`,
    id
  );
  const r = rows[0];
  return r
    ? { id: r.id, title: r.title, accepted: r.accepted, delivered: Number(r.delivered), opened: Number(r.opened) }
    : null;
}

/** messageStats for many notifications at once (the broadcast history list). */
export async function messagesStats(
  ids: string[]
): Promise<Map<string, { accepted: number; delivered: number; opened: number }>> {
  const out = new Map<string, { accepted: number; delivered: number; opened: number }>();
  const valid = ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (!valid.length) return out;
  await ensureWebPushTable();
  const rows = await prisma.$queryRawUnsafe<{ id: string; accepted: number; delivered: bigint; opened: bigint }[]>(
    `SELECT m.id::text, m.accepted, count(r.delivered_at) AS delivered, count(r.opened_at) AS opened
       FROM web_push_messages m LEFT JOIN web_push_receipts r ON r.message_id = m.id
      WHERE m.id = ANY($1::uuid[]) GROUP BY m.id`,
    valid
  );
  for (const r of rows) out.set(r.id, { accepted: r.accepted, delivered: Number(r.delivered), opened: Number(r.opened) });
  return out;
}

/**
 * Deliver to a set of subscriptions. A subscription the push service says is
 * gone (404/410 — the user unsubscribed or cleared site data) is deleted, so
 * it isn't retried forever.
 */
async function deliver(rows: SubscriptionRow[], body: string): Promise<number> {
  let sent = 0;
  const dead: string[] = [];
  const ok: string[] = [];
  await Promise.all(
    rows.map(async (r) => {
      try {
        await webpush.sendNotification(
          { endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } },
          body,
          // "high": shown straight away. On "normal", Android in Doze and
          // iPhones in Low Power Mode can sit on it for a long time.
          { TTL: 24 * 60 * 60, urgency: "high" }
        );
        sent += 1;
        ok.push(r.id);
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) dead.push(r.id);
        else console.error("[webpush] send failed", status ?? String(err));
      }
    })
  );
  if (dead.length) {
    await prisma
      .$executeRawUnsafe(`DELETE FROM web_push_subscriptions WHERE id = ANY($1::uuid[])`, dead)
      .catch(() => undefined);
  }
  if (ok.length) {
    await prisma
      .$executeRawUnsafe(`UPDATE web_push_subscriptions SET last_success_at = now() WHERE id = ANY($1::uuid[])`, ok)
      .catch(() => undefined);
  }
  return sent;
}

/** Notify one user's browsers, if they allow this category. */
export async function sendWebPush(userId: string, msg: WebPushMessage): Promise<number> {
  try {
    if (!configure()) return 0;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { notificationPrefs: true },
    });
    if (!user || !resolvePrefs(user.notificationPrefs)[msg.category]) return 0;
    await ensureWebPushTable();
    const rows = await prisma.$queryRawUnsafe<SubscriptionRow[]>(
      `SELECT id, user_id, endpoint, p256dh, auth FROM web_push_subscriptions WHERE user_id = $1::uuid`,
      userId
    );
    if (!rows.length) return 0;
    const id = msg.id ?? randomUUID();
    const sent = await deliver(rows, payload(msg, id));
    await recordMessage(id, "user", msg.title, sent);
    return sent;
  } catch (err) {
    console.error("[webpush] error", err);
    return 0;
  }
}

/** Notify every subscribed browser whose owner allows this category. */
export async function broadcastWebPush(msg: WebPushMessage): Promise<WebPushResult> {
  const id = msg.id ?? randomUUID();
  try {
    if (!configure()) return { id, accepted: 0 };
    await ensureWebPushTable();
    const rows = await prisma.$queryRawUnsafe<(SubscriptionRow & { prefs: unknown })[]>(
      `SELECT s.id, s.user_id, s.endpoint, s.p256dh, s.auth, u.notification_prefs AS prefs
         FROM web_push_subscriptions s JOIN app_users u ON u.id = s.user_id
        WHERE u.status = 'ACTIVE'`
    );
    const allowed = rows.filter((r) => resolvePrefs(r.prefs)[msg.category]);
    const body = payload(msg, id);
    // Recorded first, so a phone that reports back fast finds the message.
    await recordMessage(id, "broadcast", msg.title, 0);
    let sent = 0;
    for (let i = 0; i < allowed.length; i += 100) {
      sent += await deliver(allowed.slice(i, i + 100), body);
    }
    await recordMessage(id, "broadcast", msg.title, sent);
    return { id, accepted: sent };
  } catch (err) {
    console.error("[webpush] broadcast error", err);
    return { id, accepted: 0 };
  }
}
