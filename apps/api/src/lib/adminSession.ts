// apps/api/src/lib/adminSession.ts
//
// Admin session revocation. Kept apart from adminGuard so auth.ts can use it
// without an import cycle: requireAdmin checks the epoch on EVERY admin call,
// not only on sensitive ones, so a revoked session is locked out of the whole
// dashboard at once. See adminGuard.ts for the full rationale.

import { randomBytes } from "node:crypto";
import { prisma } from "@cheqpay/db";
import { ApiError } from "./http";

const EPOCH_KEY = "admin_session_epoch";
const EPOCH_TTL_MS = 10_000;
let epochMemo: { value: string; at: number } | null = null;

/** The current admin session epoch, minting one on first use. */
export async function getAdminSessionEpoch(): Promise<string> {
  if (epochMemo && Date.now() - epochMemo.at < EPOCH_TTL_MS) return epochMemo.value;
  let row = await prisma.platformSetting.findUnique({ where: { key: EPOCH_KEY } });
  if (!row) {
    const value = randomBytes(12).toString("hex");
    row = await prisma.platformSetting.upsert({
      where: { key: EPOCH_KEY },
      update: {},
      create: { key: EPOCH_KEY, value, updatedBy: "system" },
    });
  }
  epochMemo = { value: row.value, at: Date.now() };
  return row.value;
}

/** End every admin session. The next request from any of them is refused. */
export async function rotateAdminSessionEpoch(actor: string): Promise<string> {
  const value = randomBytes(12).toString("hex");
  await prisma.platformSetting.upsert({
    where: { key: EPOCH_KEY },
    update: { value, updatedBy: actor },
    create: { key: EPOCH_KEY, value, updatedBy: actor },
  });
  epochMemo = { value, at: Date.now() };
  return value;
}

/**
 * Refuse a dashboard call whose session predates the current epoch.
 *
 * Only calls that carry an epoch are checked: the dashboard proxy always sends
 * one, and the few server-to-server calls that do not (resolving a role during
 * login, before any session exists) have nothing to revoke. A stale session
 * cannot opt out by omitting it — the header is set by our proxy from the
 * signed cookie, not by the browser.
 */
export async function assertSessionCurrent(req: Request): Promise<void> {
  const sent = req.headers.get("x-admin-epoch");
  if (sent === null) return;
  if (sent !== (await getAdminSessionEpoch())) {
    throw new ApiError(401, "Your admin session has ended. Please sign in again.", "admin_session_revoked");
  }
}

