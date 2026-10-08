// apps/api/src/lib/devapi/accounts.ts
//
// Developer accounts: opening one (a sandbox, open to anyone with a CheqPay
// account), applying for live access (business verification), the admin's
// decision, and the switches that stop an account: suspension (every key stops
// working), freezing (money stops moving; reads continue) and the owner's own
// emergency stop.

import { randomUUID } from "node:crypto";
import { prisma } from "@cheqpay/db";
import { z } from "zod";
import { ApiError } from "../http";
import { normaliseNgnPhone } from "../ngnPhone";
import { ensureDevApiSchema } from "./ensureDevApi";
import { ensureMainWallets, seedSandboxWallets } from "./ledger";
import { decodeDataUrl, storeDevFile } from "./files";
import { invalidateKeyCache, revokeAllKeys } from "./keys";
import { alertOps, alertOwner, emailOwner, recordDevAudit } from "./audit";
import type { AccountRow } from "./types";

export async function getAccountForOwner(userId: string): Promise<AccountRow | null> {
  await ensureDevApiSchema();
  const rows = await prisma.$queryRawUnsafe<AccountRow[]>(`SELECT * FROM dev_accounts WHERE owner_user_id = $1::uuid`, userId);
  return rows[0] ?? null;
}

export async function getAccount(id: string): Promise<AccountRow | null> {
  await ensureDevApiSchema();
  const rows = await prisma.$queryRawUnsafe<AccountRow[]>(`SELECT * FROM dev_accounts WHERE id = $1::uuid`, id);
  return rows[0] ?? null;
}

const businessName = z
  .string()
  .trim()
  .min(2, "Enter your business name")
  .max(80)
  .refine((s) => !/[\u0000-\u001f<>]/.test(s), "Use letters, numbers and ordinary punctuation");

/** Open a sandbox. Idempotent: an owner has one developer account. */
export async function createAccount(userId: string, input: { businessName: unknown }): Promise<AccountRow> {
  const name = businessName.parse(input.businessName);
  const existing = await getAccountForOwner(userId);
  if (existing) return existing;
  const id = randomUUID();
  await prisma.$transaction(async (db) => {
    const inserted = await db.$queryRawUnsafe<{ id: string }[]>(
      `INSERT INTO dev_accounts (id, owner_user_id, business_name) VALUES ($1::uuid, $2::uuid, $3)
       ON CONFLICT (owner_user_id) DO NOTHING RETURNING id`,
      id,
      userId,
      name,
    );
    if (inserted.length) await seedSandboxWallets(db, id);
  });
  return (await getAccountForOwner(userId))!;
}

/** The business name can change freely until the business is verified; after that, through support. */
export async function renameAccount(account: AccountRow, name: unknown): Promise<AccountRow> {
  if (account.status !== "sandbox" && account.status !== "rejected") {
    throw new ApiError(409, "Your business is verified or under review. Email dev@mycheqpay.com to change its name.", "locked_after_review");
  }
  const rows = await prisma.$queryRawUnsafe<AccountRow[]>(
    `UPDATE dev_accounts SET business_name = $2, updated_at = now() WHERE id = $1::uuid RETURNING *`,
    account.id,
    businessName.parse(name),
  );
  return rows[0];
}

export const BUSINESS_TYPES = ["limited_company", "business_name", "incorporated_trustees", "partnership"] as const;
export const VOLUME_BANDS = ["under_1m", "1m_10m", "10m_50m", "50m_200m", "over_200m"] as const;

export const applicationSchema = z
  .object({
    legal_name: z.string().trim().min(2).max(120),
    rc_number: z
      .string()
      .trim()
      .toUpperCase()
      .transform((s) => s.replace(/\s+/g, ""))
      .refine((s) => /^(RC|BN|IT|LP|LLP)?-?\d{3,9}$/.test(s), "Enter your CAC registration number, e.g. RC1234567 or BN1234567"),
    business_type: z.enum(BUSINESS_TYPES),
    website: z
      .string()
      .trim()
      .max(200)
      .refine((s) => {
        try {
          const u = new URL(s);
          return (u.protocol === "https:" || u.protocol === "http:") && u.hostname.includes(".");
        } catch {
          return false;
        }
      }, "Enter your website, starting with https://"),
    use_case: z.string().trim().min(30, "Tell us a little more about what you'll build (at least 30 characters)").max(1500),
    expected_monthly_volume: z.enum(VOLUME_BANDS),
    contact_phone: z
      .string()
      .trim()
      .transform((s, ctx) => {
        const p = normaliseNgnPhone(s);
        if (!p) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a Nigerian phone number" });
        return p ?? "";
      }),
    address: z.string().trim().min(10).max(300),
    cac_document: z.string().max(4_500_000),
  })
  .strict();

export interface Actor {
  userId: string;
  ip: string | null;
  userAgent: string | null;
}

/**
 * Apply for live access. The owner must have verified their own identity in
 * the CheqPay app (the person behind the business is known before the business
 * is). The registration certificate is stored encrypted.
 */
export async function submitApplication(account: AccountRow, body: unknown, actor: Actor): Promise<AccountRow> {
  if (account.status === "pending_review") throw new ApiError(409, "Your application is already being reviewed.", "already_submitted");
  if (account.status === "approved") throw new ApiError(409, "Your business is already verified.", "already_approved");
  if (account.status === "suspended") throw new ApiError(403, "This account is suspended. Email dev@mycheqpay.com.", "account_suspended");

  const owner = await prisma.user.findUnique({ where: { id: account.owner_user_id }, select: { kycTier: true } });
  if (!owner || owner.kycTier < 1) {
    throw new ApiError(403, "Verify your own identity in the CheqPay app first, then apply.", "kyc_required");
  }
  const input = applicationSchema.parse(body);
  const doc = decodeDataUrl(input.cac_document);
  const fileId = await storeDevFile({
    accountId: account.id,
    mode: "live",
    purpose: "business_document",
    bytes: doc.bytes,
    contentType: doc.contentType,
  });

  const rows = await prisma.$queryRawUnsafe<AccountRow[]>(
    `UPDATE dev_accounts SET status = 'pending_review', legal_name = $2, rc_number = $3, business_type = $4, website = $5,
       use_case = $6, expected_monthly_volume = $7, contact_phone = $8, address = $9, cac_file_id = $10::uuid,
       submitted_at = now(), review_note = NULL, updated_at = now()
     WHERE id = $1::uuid AND status IN ('sandbox', 'rejected')
     RETURNING *`,
    account.id,
    input.legal_name,
    input.rc_number,
    input.business_type,
    input.website,
    input.use_case,
    input.expected_monthly_volume,
    input.contact_phone,
    input.address,
    fileId,
  );
  if (!rows[0]) throw new ApiError(409, "This application can't be submitted right now.", "already_submitted");
  await recordDevAudit({
    accountId: account.id,
    actor: "owner",
    action: "application.submitted",
    details: { rc_number: input.rc_number, business_type: input.business_type },
    ip: actor.ip,
    userAgent: actor.userAgent,
  });
  alertOps(`🧑‍💻 New developer application: ${input.legal_name} (${input.rc_number})`, { account: account.id });
  return rows[0];
}

export interface ReviewDecision {
  approve: boolean;
  note?: string;
  limits?: {
    dailyOutNgnMinor?: bigint | null;
    dailyOutUsdMinor?: bigint | null;
    maxFloatNgnMinor?: bigint | null;
    maxFloatUsdMinor?: bigint | null;
  };
}

/** The admin's decision on an application. */
export async function reviewApplication(accountId: string, d: ReviewDecision, adminEmail: string): Promise<AccountRow> {
  const account = await getAccount(accountId);
  if (!account) throw new ApiError(404, "No such developer account", "not_found");
  if (account.status !== "pending_review") throw new ApiError(409, "This application isn't waiting for review.", "not_pending");
  const note = (d.note ?? "").trim();
  if (!d.approve && note.length < 10) {
    throw new ApiError(400, "Tell the business why (at least 10 characters). They see this.", "reason_required");
  }

  const updated = await prisma.$transaction(async (db) => {
    const rows = await db.$queryRawUnsafe<AccountRow[]>(
      d.approve
        ? `UPDATE dev_accounts SET status = 'approved', review_note = $2, reviewed_by = $3, reviewed_at = now(),
             live_since = COALESCE(live_since, now()),
             daily_out_limit_ngn = $4, daily_out_limit_usd = $5, max_float_ngn = $6, max_float_usd = $7, updated_at = now()
           WHERE id = $1::uuid AND status = 'pending_review' RETURNING *`
        : `UPDATE dev_accounts SET status = 'rejected', review_note = $2, reviewed_by = $3, reviewed_at = now(), updated_at = now()
           WHERE id = $1::uuid AND status = 'pending_review' RETURNING *`,
      ...(d.approve
        ? [
            accountId,
            note || null,
            adminEmail,
            d.limits?.dailyOutNgnMinor ?? null,
            d.limits?.dailyOutUsdMinor ?? null,
            d.limits?.maxFloatNgnMinor ?? null,
            d.limits?.maxFloatUsdMinor ?? null,
          ]
        : [accountId, note, adminEmail]),
    );
    if (!rows[0]) throw new ApiError(409, "This application isn't waiting for review.", "not_pending");
    if (d.approve) await ensureMainWallets(db, accountId, "live");
    return rows[0];
  });

  await recordDevAudit({
    accountId,
    actor: `admin:${adminEmail}`,
    action: d.approve ? "application.approved" : "application.rejected",
    details: note ? { note } : {},
  });
  invalidateKeyCache();
  emailOwner(updated, {
    title: d.approve ? "Your business is verified" : "Your developer application needs changes",
    body: d.approve
      ? "You can now choose a plan, fund your main wallet and create live API keys from the developer dashboard."
      : `We couldn't approve your application yet: ${note} You can update it and apply again from the developer dashboard.`,
  });
  return updated;
}

export type AdminAccountAction =
  | { action: "suspend"; reason: string }
  | { action: "unsuspend" }
  | { action: "freeze"; reason: string }
  | { action: "unfreeze" }
  | { action: "revoke_keys"; mode?: "test" | "live" }
  | { action: "require_ip_allowlist"; value: boolean }
  | {
      action: "set_limits";
      dailyOutNgnMinor: bigint | null;
      dailyOutUsdMinor: bigint | null;
      maxFloatNgnMinor: bigint | null;
      maxFloatUsdMinor: bigint | null;
    };

export async function adminAccountAction(accountId: string, a: AdminAccountAction, adminEmail: string): Promise<AccountRow> {
  const account = await getAccount(accountId);
  if (!account) throw new ApiError(404, "No such developer account", "not_found");
  let rows: AccountRow[] = [];
  switch (a.action) {
    case "suspend":
      if (account.status === "suspended") throw new ApiError(409, "Already suspended", "already_suspended");
      rows = await prisma.$queryRawUnsafe<AccountRow[]>(
        `UPDATE dev_accounts SET status_before_suspension = status, status = 'suspended', suspended_reason = $2, updated_at = now()
          WHERE id = $1::uuid RETURNING *`,
        accountId,
        a.reason,
      );
      break;
    case "unsuspend":
      if (account.status !== "suspended") throw new ApiError(409, "This account isn't suspended", "not_suspended");
      rows = await prisma.$queryRawUnsafe<AccountRow[]>(
        `UPDATE dev_accounts SET status = COALESCE(status_before_suspension, 'sandbox'), status_before_suspension = NULL,
           suspended_reason = NULL, updated_at = now() WHERE id = $1::uuid RETURNING *`,
        accountId,
      );
      break;
    case "freeze":
      rows = await prisma.$queryRawUnsafe<AccountRow[]>(
        `UPDATE dev_accounts SET frozen = true, frozen_reason = $2, frozen_by = 'admin', updated_at = now() WHERE id = $1::uuid RETURNING *`,
        accountId,
        a.reason,
      );
      break;
    case "unfreeze":
      rows = await prisma.$queryRawUnsafe<AccountRow[]>(
        `UPDATE dev_accounts SET frozen = false, frozen_reason = NULL, frozen_by = NULL, updated_at = now() WHERE id = $1::uuid RETURNING *`,
        accountId,
      );
      break;
    case "revoke_keys":
      // The developer sees the reason; which admin did it stays in the audit log.
      await revokeAllKeys(accountId, "revoked by CheqPay", a.mode);
      rows = [account];
      break;
    case "require_ip_allowlist":
      rows = await prisma.$queryRawUnsafe<AccountRow[]>(
        `UPDATE dev_accounts SET require_ip_allowlist = $2, updated_at = now() WHERE id = $1::uuid RETURNING *`,
        accountId,
        a.value,
      );
      break;
    case "set_limits":
      rows = await prisma.$queryRawUnsafe<AccountRow[]>(
        `UPDATE dev_accounts SET daily_out_limit_ngn = $2, daily_out_limit_usd = $3, max_float_ngn = $4, max_float_usd = $5,
           updated_at = now() WHERE id = $1::uuid RETURNING *`,
        accountId,
        a.dailyOutNgnMinor,
        a.dailyOutUsdMinor,
        a.maxFloatNgnMinor,
        a.maxFloatUsdMinor,
      );
      break;
  }
  invalidateKeyCache();
  const { action, ...details } = a;
  await recordDevAudit({
    accountId,
    actor: `admin:${adminEmail}`,
    action: `admin.${action}`,
    details: JSON.parse(JSON.stringify(details, (_k, v) => (typeof v === "bigint" ? v.toString() : v))),
  });
  if (a.action === "suspend" || a.action === "freeze") {
    alertOwner(account, {
      title: a.action === "suspend" ? "Your developer account was suspended" : "Money movement on your developer account was paused",
      body: `CheqPay ${a.action === "suspend" ? "suspended your developer account" : "paused money movement on your developer account"}: ${a.reason}`,
    });
  }
  return rows[0] ?? account;
}

/**
 * The owner's emergency stop: revoke every live key and freeze money movement,
 * in one press. Deliberately needs nothing but the signed-in session — it only
 * ever takes access away, and in an emergency every extra step is a delay.
 */
export async function emergencyStop(account: AccountRow, actor: Actor): Promise<{ keysRevoked: number }> {
  const keysRevoked = await revokeAllKeys(account.id, "emergency stop", "live");
  // Only an unfrozen account becomes owner-frozen. A freeze CheqPay (or the
  // system) already placed stays exactly as it is: if pressing stop could
  // relabel it as the owner's, the owner could then lift it with "resume" and
  // move held money out from under an investigation.
  await prisma.$executeRawUnsafe(
    `UPDATE dev_accounts SET frozen = true, frozen_reason = 'Emergency stop pressed by the owner', frozen_by = 'owner', updated_at = now()
      WHERE id = $1::uuid AND frozen = false`,
    account.id,
  );
  invalidateKeyCache();
  await recordDevAudit({ accountId: account.id, actor: "owner", action: "emergency_stop", details: { keysRevoked }, ip: actor.ip, userAgent: actor.userAgent });
  alertOwner(account, {
    title: "Emergency stop pressed",
    body: `All live API keys were revoked (${keysRevoked}) and money movement is paused. Create new keys and resume when it's safe.`,
  });
  alertOps(`🛑 Developer emergency stop: ${account.business_name}`, { account: account.id });
  return { keysRevoked };
}

/** Undo an emergency stop. Only the owner's own stop: a freeze by CheqPay is lifted by CheqPay. */
export async function resumeAfterStop(account: AccountRow, actor: Actor): Promise<AccountRow> {
  if (!account.frozen) return account;
  if (account.frozen_by !== "owner") {
    throw new ApiError(403, "CheqPay paused this account. Email dev@mycheqpay.com.", "frozen_by_cheqpay");
  }
  const rows = await prisma.$queryRawUnsafe<AccountRow[]>(
    `UPDATE dev_accounts SET frozen = false, frozen_reason = NULL, frozen_by = NULL, updated_at = now()
      WHERE id = $1::uuid AND frozen_by = 'owner' RETURNING *`,
    account.id,
  );
  invalidateKeyCache();
  await recordDevAudit({ accountId: account.id, actor: "owner", action: "emergency_stop.lifted", ip: actor.ip, userAgent: actor.userAgent });
  alertOwner(account, { title: "Money movement resumed", body: "The emergency stop on your developer account was lifted." });
  return rows[0] ?? account;
}
