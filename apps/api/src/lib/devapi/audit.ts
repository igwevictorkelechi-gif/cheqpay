// apps/api/src/lib/devapi/audit.ts
//
// The developer's security log, and the emails that tell the owner about
// security-relevant changes as they happen. A hijacked dashboard session that
// adds a webhook URL or a live key is then visible to the real owner within
// minutes, in their inbox, rather than whenever they next look.

import { after } from "next/server";
import { prisma } from "@cheqpay/db";
import { DEVELOPER_CONTACT } from "@cheqpay/devapi";
import { isEmailConfigured, sendEmail } from "../email";
import { renderEmail, subjectFor, type EmailContent } from "../emailTemplates";
import { notifyAdminAlert } from "../adminAlert";
import { ensureDevApiSchema } from "./ensureDevApi";
import type { AccountRow } from "./types";

export interface AuditEntry {
  accountId: string;
  /** "owner", "admin:<email>", "key:<id>" or "system". */
  actor: string;
  action: string;
  target?: string | null;
  details?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
}

export async function recordDevAudit(entry: AuditEntry): Promise<void> {
  await ensureDevApiSchema();
  await prisma.$executeRawUnsafe(
    `INSERT INTO dev_audit_logs (account_id, actor, action, target, details, ip, user_agent)
     VALUES ($1::uuid, $2, $3, $4, $5::jsonb, $6, $7)`,
    entry.accountId,
    entry.actor.slice(0, 120),
    entry.action.slice(0, 80),
    entry.target?.slice(0, 200) ?? null,
    JSON.stringify(entry.details ?? {}),
    entry.ip ?? null,
    entry.userAgent?.slice(0, 400) ?? null,
  );
}

export interface AuditRow {
  id: string;
  actor: string;
  action: string;
  target: string | null;
  details: Record<string, unknown>;
  ip: string | null;
  user_agent: string | null;
  created_at: Date;
}

export async function listDevAudit(accountId: string, limit = 100): Promise<AuditRow[]> {
  await ensureDevApiSchema();
  return prisma.$queryRawUnsafe<AuditRow[]>(
    `SELECT id, actor, action, target, details, ip, user_agent, created_at FROM dev_audit_logs
      WHERE account_id = $1::uuid ORDER BY created_at DESC LIMIT $2`,
    accountId,
    Math.min(Math.max(limit, 1), 200),
  );
}

/** Run after the response when inside a request, inline otherwise (cron, tests). */
export function later(task: () => Promise<unknown>): void {
  const run = () => task().catch((err) => console.error("[devapi] background task failed", err));
  try {
    after(run);
  } catch {
    void run();
  }
}

/**
 * Email the account owner about a security-relevant change. Always sent — it
 * deliberately ignores notification preferences, because a security notice the
 * owner switched off is one an attacker would switch off first.
 */
export function alertOwner(
  account: Pick<AccountRow, "owner_user_id" | "business_name">,
  msg: { title: string; body: string; details?: { label: string; value: string }[] },
): void {
  later(async () => {
    if (!isEmailConfigured()) return;
    const user = await prisma.user.findUnique({ where: { id: account.owner_user_id }, select: { email: true } });
    if (!user?.email) return;
    const content: EmailContent = {
      kind: "security",
      title: msg.title,
      body: msg.body,
      details: [{ label: "Developer account", value: account.business_name }, ...(msg.details ?? [])],
      footnote: `If this wasn't you, press "Emergency stop" in your developer dashboard and email ${DEVELOPER_CONTACT}.`,
    };
    await sendEmail({ to: user.email, subject: subjectFor(content), html: renderEmail(content), replyTo: DEVELOPER_CONTACT });
  });
}

/** A plain, non-security email to the owner (application decisions, billing). */
export function emailOwner(
  account: Pick<AccountRow, "owner_user_id" | "business_name">,
  msg: { title: string; body: string; details?: { label: string; value: string }[]; kind?: EmailContent["kind"] },
): void {
  later(async () => {
    if (!isEmailConfigured()) return;
    const user = await prisma.user.findUnique({ where: { id: account.owner_user_id }, select: { email: true } });
    if (!user?.email) return;
    const content: EmailContent = {
      kind: msg.kind ?? "statement",
      title: msg.title,
      body: msg.body,
      details: [{ label: "Developer account", value: account.business_name }, ...(msg.details ?? [])],
      footnote: `Questions? Reply to this email or write to ${DEVELOPER_CONTACT}.`,
    };
    await sendEmail({ to: user.email, subject: subjectFor(content), html: renderEmail(content), replyTo: DEVELOPER_CONTACT });
  });
}

/** Tell ops (the admin alert channel). Never throws. */
export function alertOps(text: string, fields?: Record<string, string>): void {
  later(() => notifyAdminAlert(text, fields));
}
