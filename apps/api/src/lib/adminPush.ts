// apps/api/src/lib/adminPush.ts
//
// Alerts on the admin dashboard itself. An admin who turns on alerts in the
// dashboard (installed as an app, or just open in a browser) gives us a push
// subscription, kept here against their admin email, not a CheqPay account,
// so it works for sub admins who have no customer account at all.
//
// Same VAPID keys and push services as the customer app (webPush.ts); a
// separate table, because an admin's browser belongs to an admin session, and
// who receives an alert is decided by dashboard access, not notification prefs.
// Never throws: an alert is a side effect.

import webpush from "web-push";
import { prisma } from "@cheqpay/db";
import { configure, webPushPublicKey } from "./webPush";

export interface AdminPushMessage {
  title: string;
  body: string;
  /** Dashboard path to open when the alert is tapped, e.g. "/gift-cards". */
  url: string;
  /** Alerts with the same tag replace each other instead of piling up. */
  tag?: string;
}

interface Row {
  endpoint: string;
  p256dh: string;
  auth: string;
}

let ready: Promise<void> | null = null;
export function ensureAdminPushTable(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS admin_push_subscriptions (
          endpoint text PRIMARY KEY,
          admin_email text NOT NULL,
          p256dh text NOT NULL,
          auth text NOT NULL,
          user_agent text,
          created_at timestamptz NOT NULL DEFAULT now(),
          last_success_at timestamptz
        )`);
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS admin_push_subscriptions_email_idx ON admin_push_subscriptions(admin_email)`,
      );
    })().catch((err) => {
      ready = null;
      throw err;
    });
  }
  return ready;
}

export { webPushPublicKey as adminPushPublicKey };

/** Keep (or move to this admin) a browser's subscription. */
export async function saveAdminSubscription(
  email: string,
  sub: { endpoint: string; keys: { p256dh: string; auth: string } },
  userAgent: string | null,
): Promise<void> {
  await ensureAdminPushTable();
  await prisma.$executeRawUnsafe(
    `INSERT INTO admin_push_subscriptions (endpoint, admin_email, p256dh, auth, user_agent)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (endpoint) DO UPDATE SET
       admin_email = EXCLUDED.admin_email, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
       user_agent = EXCLUDED.user_agent`,
    sub.endpoint,
    email.trim().toLowerCase(),
    sub.keys.p256dh,
    sub.keys.auth,
    (userAgent ?? "").slice(0, 300),
  );
}

/** Remove one of this admin's subscriptions. */
export async function removeAdminSubscription(email: string, endpoint: string): Promise<void> {
  await ensureAdminPushTable();
  await prisma.$executeRawUnsafe(
    `DELETE FROM admin_push_subscriptions WHERE admin_email = $1 AND endpoint = $2`,
    email.trim().toLowerCase(),
    endpoint,
  );
}

/** Whether this browser is subscribed for this admin. */
export async function isAdminSubscribed(email: string, endpoint: string): Promise<boolean> {
  await ensureAdminPushTable();
  const rows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*)::bigint AS n FROM admin_push_subscriptions WHERE admin_email = $1 AND endpoint = $2`,
    email.trim().toLowerCase(),
    endpoint,
  );
  return Number(rows[0]?.n ?? 0) > 0;
}

/**
 * Push an alert to every dashboard browser of these admins. Returns how many
 * the push services accepted. A subscription they report gone (404/410) is
 * deleted.
 */
export async function sendAdminPush(emails: string[], msg: AdminPushMessage): Promise<number> {
  try {
    if (!emails.length || !configure()) return 0;
    await ensureAdminPushTable();
    const rows = await prisma.$queryRawUnsafe<Row[]>(
      `SELECT endpoint, p256dh, auth FROM admin_push_subscriptions WHERE admin_email = ANY($1::text[])`,
      emails.map((e) => e.trim().toLowerCase()),
    );
    if (!rows.length) return 0;
    const body = JSON.stringify({ title: msg.title, body: msg.body, url: msg.url, tag: msg.tag ?? null });
    const dead: string[] = [];
    const ok: string[] = [];
    await Promise.all(
      rows.map(async (r) => {
        try {
          await webpush.sendNotification({ endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }, body, {
            TTL: 24 * 60 * 60,
            urgency: "high",
          });
          ok.push(r.endpoint);
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) dead.push(r.endpoint);
          else console.error("[admin push] send failed", status ?? String(err));
        }
      }),
    );
    if (dead.length) {
      await prisma
        .$executeRawUnsafe(`DELETE FROM admin_push_subscriptions WHERE endpoint = ANY($1::text[])`, dead)
        .catch(() => undefined);
    }
    if (ok.length) {
      await prisma
        .$executeRawUnsafe(`UPDATE admin_push_subscriptions SET last_success_at = now() WHERE endpoint = ANY($1::text[])`, ok)
        .catch(() => undefined);
    }
    return ok.length;
  } catch (err) {
    console.error("[admin push] error", err);
    return 0;
  }
}
