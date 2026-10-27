// apps/api/src/lib/adminNotify.ts
//
// Tell the people who run CheqPay that something needs them: an alert on each
// admin's dashboard (the installed admin app or browser where they turned
// alerts on), a push to their own CheqPay app and browser (when their admin
// email also has a CheqPay account), an email, and the ops webhook if one is
// set. Used for review queues (gift cards, ad campaigns). Best effort — never
// throws.
//
// Who hears about what follows dashboard access: the owners always, and a sub
// admin only for the sections a Super Admin has granted them. A sub admin who
// can't open Gift cards isn't told a card is waiting.

import { prisma } from "@cheqpay/db";
import { notifyAdminAlert } from "./adminAlert";
import { getAdminEmail, listSubAdmins } from "./adminCreds";
import { sendAdminPush } from "./adminPush";
import type { AdminSection } from "./adminSections";
import { isEmailConfigured, sendEmail } from "./email";
import { getEnv } from "./env";
import { sendPush } from "./push";
import { sendWebPush } from "./webPush";

const MAX_ADMIN_RECIPIENTS = 10;

const isEmail = (e: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);

/**
 * The owners in ADMIN_EMAILS plus the sub admins who may open `section` (every
 * working sub admin when none is given), lowercased and de-duplicated.
 */
export async function adminRecipientEmails(section?: AdminSection): Promise<string[]> {
  const owners = (getEnv().ADMIN_EMAILS ?? "").split(",");
  let subAdmins: string[] = [];
  try {
    subAdmins = (await listSubAdmins())
      .filter((s) => s.status !== "no_password" && (!section || s.sections.includes(section)))
      .map((s) => s.email);
  } catch {
    // No sub admins set up yet is fine.
  }
  const all = [...owners, ...subAdmins].map((e) => e.trim().toLowerCase()).filter(isEmail);
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
  /** The dashboard section it belongs to: only admins who can open it are told. */
  section?: AdminSection;
  /** Dashboard page the alert opens, e.g. "/gift-cards". */
  url?: string;
}

export async function notifyAdmins(n: AdminNotice): Promise<void> {
  const emails = await adminRecipientEmails(n.section);
  // Dashboard alerts also reach the main admin login, which signs in under its
  // own email (not necessarily a mailbox, so it gets no email).
  const mainLogin = (await getAdminEmail().catch(() => "")).trim().toLowerCase();
  const dashboard = [...new Set([...emails, ...(isEmail(mainLogin) ? [mainLogin] : [])])];
  await sendAdminPush(dashboard, {
    title: n.title,
    body: n.body,
    url: n.url ?? "/dashboard",
    tag: n.section ?? "admin",
  }).catch(() => 0);
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
