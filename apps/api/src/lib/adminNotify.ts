// apps/api/src/lib/adminNotify.ts
//
// Tell the people who run CheqPay that something needs them: a push to each
// admin's own CheqPay app and browser (when their admin email also has a
// CheqPay account), an email, and the ops webhook if one is set. Used for
// review queues (gift cards, ad campaigns). Best effort — never throws.

import { prisma } from "@cheqpay/db";
import { notifyAdminAlert } from "./adminAlert";
import { isEmailConfigured, sendEmail } from "./email";
import { getEnv } from "./env";
import { sendPush } from "./push";
import { sendWebPush } from "./webPush";

const MAX_ADMIN_RECIPIENTS = 10;

/** The owners in ADMIN_EMAILS plus every sub admin account, lowercased and de-duplicated. */
export async function adminRecipientEmails(): Promise<string[]> {
  const fromEnv = (getEnv().ADMIN_EMAILS ?? "").split(",");
  let subAdmins: { email: string }[] = [];
  try {
    subAdmins = await prisma.$queryRawUnsafe<{ email: string }[]>(`SELECT email FROM admin_accounts`);
  } catch {
    // admin_accounts is created on first sub-admin login; none yet is fine.
  }
  const all = [...fromEnv, ...subAdmins.map((a) => a.email)]
    .map((e) => e.trim().toLowerCase())
    .filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
  return [...new Set(all)].slice(0, MAX_ADMIN_RECIPIENTS);
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export interface AdminNotice {
  title: string;
  body: string;
  /** Label/value rows for the email. */
  rows: [string, string][];
  /** Where in the dashboard to act, e.g. "Gift cards". */
  where: string;
  emailSubject: string;
  /** Extra push data; also sent as webhook fields. */
  data: Record<string, string>;
  /** Emoji prefix for the webhook line. */
  icon?: string;
}

export async function notifyAdmins(n: AdminNotice): Promise<void> {
  const emails = await adminRecipientEmails();
  if (emails.length) {
    const admins = await prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id::text FROM app_users WHERE lower(email) = ANY($1::text[])`, emails,
    ).catch(() => []);
    const push = { title: n.title, body: n.body, category: "trades" as const, data: n.data };
    await Promise.all(admins.flatMap((a) => [sendPush(a.id, push).catch(() => 0), sendWebPush(a.id, push).catch(() => 0)]));

    if (isEmailConfigured()) {
      const html =
        `<p><strong>${escapeHtml(n.title)}</strong></p>` +
        `<table cellpadding="4">${n.rows.map(([k, v]) => `<tr><td style="color:#666">${escapeHtml(k)}</td><td><strong>${escapeHtml(v)}</strong></td></tr>`).join("")}</table>` +
        `<p>Open the admin dashboard → ${escapeHtml(n.where)} to review it.</p>`;
      for (const to of emails) {
        await sendEmail({ to, subject: n.emailSubject, html }).catch(() => undefined);
      }
    }
  }
  await notifyAdminAlert(`${n.icon ? `${n.icon} ` : ""}${n.title} — ${n.body}`, n.data).catch(() => undefined);
}
