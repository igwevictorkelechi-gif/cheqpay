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
    webpush.setVapidDetails(VAPID_SUBJECT || "mailto:support@cheqpay.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
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

function payload(msg: WebPushMessage): string {
  return JSON.stringify({
    title: msg.title,
    body: msg.body,
    url: msg.url ?? null,
    category: msg.category,
    data: msg.data ?? {},
  });
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
          { TTL: 24 * 60 * 60, urgency: "normal" }
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
    return rows.length ? await deliver(rows, payload(msg)) : 0;
  } catch (err) {
    console.error("[webpush] error", err);
    return 0;
  }
}

/** Notify every subscribed browser whose owner allows this category. */
export async function broadcastWebPush(msg: WebPushMessage): Promise<number> {
  try {
    if (!configure()) return 0;
    await ensureWebPushTable();
    const rows = await prisma.$queryRawUnsafe<(SubscriptionRow & { prefs: unknown })[]>(
      `SELECT s.id, s.user_id, s.endpoint, s.p256dh, s.auth, u.notification_prefs AS prefs
         FROM web_push_subscriptions s JOIN app_users u ON u.id = s.user_id
        WHERE u.status = 'ACTIVE'`
    );
    const allowed = rows.filter((r) => resolvePrefs(r.prefs)[msg.category]);
    const body = payload(msg);
    let sent = 0;
    for (let i = 0; i < allowed.length; i += 100) {
      sent += await deliver(allowed.slice(i, i + 100), body);
    }
    return sent;
  } catch (err) {
    console.error("[webpush] broadcast error", err);
    return 0;
  }
}
