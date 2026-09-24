// apps/api/src/lib/accessControl.ts
//
// Who is allowed to use the API at all.
//
// Blocking an account used to be cosmetic. The admin page wrote BLOCKED to the
// user row, and nothing on the request path ever read it: requireUser checked
// the Supabase token and nothing else, so a blocked account kept full access —
// balances, transfers, withdrawals — for as long as its token lived. That is how
// an account blocked on 22 Sep was still able to move money twenty minutes
// later. This module is the check that was missing, and requireUser calls it on
// every authenticated request.
//
// Three independent layers, because each one alone is easy to step around:
//
//  1. ACCOUNT STATUS. A BLOCKED, SUSPENDED or DELETED account is refused.
//  2. IP. Requests from a blocklisted address are refused, including a brand-new
//     signup's very first call, so a blocked person cannot simply register again
//     from the same place.
//  3. IDENTITY. A new account that presents the BVN or phone of a blocked
//     account is itself blocked (see blockIfLinkedToBlocked).
//
// IP blocking is a speed bump, not a wall — a VPN changes address in seconds —
// which is why it sits alongside the other two rather than replacing them.

import { UserStatus, prisma } from "@cheqpay/db";
import { ApiError } from "./http";

/** Statuses that may not use the API. */
const DENIED: ReadonlySet<string> = new Set([
  UserStatus.BLOCKED,
  UserStatus.SUSPENDED,
  UserStatus.DELETED,
]);

export class AccountBlockedError extends ApiError {
  constructor(message = "This account has been blocked. Contact support if you believe this is a mistake.") {
    super(403, message, "account_blocked");
  }
}

// ---------------------------------------------------------------------------
// Caching.
//
// Both checks run on every authenticated request, so each is memoised per
// instance for a short window. The window is the longest a block can take to
// bite on an instance that already served the user; it is kept short because a
// block that lags is a block that lets money out. Blocking also revokes the
// user's Supabase sessions (see revokeAuthSessions), so a blocked user cannot
// mint a fresh token to ride out the window either.
// ---------------------------------------------------------------------------

const STATUS_TTL_MS = 10_000;
const IP_TTL_MS = 15_000;

const statusMemo = new Map<string, { status: string | null; at: number }>();

/** Forget cached state after a block/unblock so this instance acts at once. */
export function invalidateAccessCache(userId?: string): void {
  if (userId) statusMemo.delete(userId);
  else statusMemo.clear();
  ipMemo = null;
}

async function accountStatus(userId: string): Promise<string | null> {
  const hit = statusMemo.get(userId);
  if (hit && Date.now() - hit.at < STATUS_TTL_MS) return hit.status;
  const row = await prisma.user.findUnique({ where: { id: userId }, select: { status: true } });
  const status = row?.status ?? null;
  statusMemo.set(userId, { status, at: Date.now() });
  return status;
}

// ---------------------------------------------------------------------------
// IP blocklist.
// ---------------------------------------------------------------------------

/**
 * The table. A new table is safe to create lazily (nothing selects it before
 * this runs), so it is not wired into instrumentation.ts.
 *
 * The same statement was applied to production by hand when the first
 * addresses were blocked, so the two cannot drift.
 */
export const BLOCKED_IPS_DDL = `
  CREATE TABLE IF NOT EXISTS blocked_ips (
    ip TEXT PRIMARY KEY,
    reason TEXT NOT NULL,
    source_user_id UUID NULL,
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NULL
  )`;

let schemaReady: Promise<void> | null = null;
export function ensureBlockedIpsSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = prisma
      .$executeRawUnsafe(BLOCKED_IPS_DDL)
      .then(() => undefined)
      .catch((err) => {
        schemaReady = null;
        throw err;
      });
  }
  return schemaReady;
}

let ipMemo: { ips: Set<string>; at: number } | null = null;

async function blockedIpSet(): Promise<Set<string>> {
  if (ipMemo && Date.now() - ipMemo.at < IP_TTL_MS) return ipMemo.ips;
  await ensureBlockedIpsSchema();
  const rows = await prisma.$queryRawUnsafe<{ ip: string }[]>(
    `SELECT ip FROM blocked_ips WHERE expires_at IS NULL OR expires_at > now()`,
  );
  ipMemo = { ips: new Set(rows.map((r) => r.ip)), at: Date.now() };
  return ipMemo.ips;
}

function normalize(ip: string): string {
  const t = ip.trim();
  return t.startsWith("::ffff:") ? t.slice(7) : t;
}

/**
 * Every address this request could plausibly have come from.
 *
 * The first `x-forwarded-for` entry is client-controlled: anyone can send the
 * header and our proxies append to it rather than replace it. Checking only
 * that entry would let a blocked caller walk past the blocklist by setting it.
 * So every candidate is checked, including the ones the platform sets itself,
 * and a match on ANY of them refuses the request. Forging one header cannot
 * remove the address the platform recorded.
 */
export function candidateIps(req: Request): string[] {
  const out = new Set<string>();
  const xff = req.headers.get("x-forwarded-for");
  if (xff) for (const part of xff.split(",")) if (part.trim()) out.add(normalize(part));
  for (const h of ["x-real-ip", "x-vercel-forwarded-for", "cf-connecting-ip"]) {
    const v = req.headers.get(h);
    if (v) for (const part of v.split(",")) if (part.trim()) out.add(normalize(part));
  }
  return [...out];
}

export async function isIpBlocked(ip: string): Promise<boolean> {
  return (await blockedIpSet()).has(normalize(ip));
}

/**
 * Refuse the request when the account or the address is blocked.
 *
 * Called from requireUser after the token checks out, so it covers every
 * authenticated route without each one remembering.
 */
export async function assertAccessAllowed(req: Request, userId: string): Promise<void> {
  const [status, ips] = await Promise.all([accountStatus(userId), blockedIpSet()]);
  if (status && DENIED.has(status)) throw new AccountBlockedError();
  if (ips.size > 0 && candidateIps(req).some((ip) => ips.has(ip))) {
    throw new AccountBlockedError("Access from this network has been blocked.");
  }
}

/** Add addresses to the blocklist. Idempotent: a re-block keeps the first reason. */
export async function blockIps(
  ips: string[],
  opts: { reason: string; actor: string; sourceUserId?: string | null },
): Promise<string[]> {
  const clean = [...new Set(ips.map(normalize).filter((ip) => /^[0-9a-f:.]{3,45}$/i.test(ip)))];
  if (clean.length === 0) return [];
  await ensureBlockedIpsSchema();
  for (const ip of clean) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO blocked_ips (ip, reason, source_user_id, created_by)
       VALUES ($1, $2, $3::uuid, $4) ON CONFLICT (ip) DO NOTHING`,
      ip,
      opts.reason.slice(0, 500),
      opts.sourceUserId ?? null,
      opts.actor,
    );
  }
  ipMemo = null;
  return clean;
}

export async function unblockIp(ip: string): Promise<boolean> {
  await ensureBlockedIpsSchema();
  const n = await prisma.$executeRawUnsafe(`DELETE FROM blocked_ips WHERE ip = $1`, normalize(ip));
  ipMemo = null;
  return n > 0;
}

export interface BlockedIpRow {
  ip: string;
  reason: string;
  sourceUserId: string | null;
  createdBy: string;
  createdAt: Date;
  expiresAt: Date | null;
}

export async function listBlockedIps(): Promise<BlockedIpRow[]> {
  await ensureBlockedIpsSchema();
  const rows = await prisma.$queryRawUnsafe<
    {
      ip: string;
      reason: string;
      source_user_id: string | null;
      created_by: string;
      created_at: Date;
      expires_at: Date | null;
    }[]
  >(`SELECT ip, reason, source_user_id, created_by, created_at, expires_at
     FROM blocked_ips ORDER BY created_at DESC`);
  return rows.map((r) => ({
    ip: r.ip,
    reason: r.reason,
    sourceUserId: r.source_user_id,
    createdBy: r.created_by,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
  }));
}

/**
 * Every address an account has been seen on: the last-seen IP plus the session
 * history. Blocking a person means blocking where they come from, not just the
 * one address they happened to use last.
 */
export async function knownIpsForUser(userId: string): Promise<string[]> {
  const [user, sessions] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { lastIp: true } }),
    prisma.userSession
      .findMany({ where: { userId }, select: { ipAddress: true } })
      .catch(() => [] as { ipAddress: string }[]),
  ]);
  const ips = new Set<string>();
  if (user?.lastIp) ips.add(normalize(user.lastIp));
  for (const s of sessions) if (s.ipAddress) ips.add(normalize(s.ipAddress));
  return [...ips];
}

// ---------------------------------------------------------------------------
// Supabase Auth: make a block stick at the login layer too.
// ---------------------------------------------------------------------------

/**
 * Ban the user in Supabase Auth and end every session they hold.
 *
 * The API check above refuses a blocked account's requests; this stops them
 * signing in or refreshing a token at all. Done in SQL against the auth schema
 * because the API does not hold a service-role key — the same database the app
 * already writes to. Best-effort: the API-side check is the one that must hold,
 * so a failure here is logged, not thrown.
 */
export async function revokeAuthSessions(userId: string): Promise<boolean> {
  try {
    await prisma.$transaction([
      prisma.$executeRawUnsafe(
        `UPDATE auth.users SET banned_until = '2999-12-31 00:00:00+00' WHERE id = $1::uuid`,
        userId,
      ),
      prisma.$executeRawUnsafe(`DELETE FROM auth.refresh_tokens WHERE user_id = $1`, userId),
      prisma.$executeRawUnsafe(`DELETE FROM auth.sessions WHERE user_id = $1::uuid`, userId),
    ]);
    return true;
  } catch (err) {
    console.error("[access] could not revoke auth sessions", { userId, err });
    return false;
  }
}

/** Lift a login-layer ban (the reverse of revokeAuthSessions). */
export async function liftAuthBan(userId: string): Promise<boolean> {
  try {
    await prisma.$executeRawUnsafe(
      `UPDATE auth.users SET banned_until = NULL WHERE id = $1::uuid`,
      userId,
    );
    return true;
  } catch (err) {
    console.error("[access] could not lift auth ban", { userId, err });
    return false;
  }
}

// ---------------------------------------------------------------------------
// Identity: stop a blocked person coming back under a new email.
// ---------------------------------------------------------------------------

/**
 * Block `userId` when it shares a BVN or phone with an account that is already
 * blocked. Returns the id it matched, or null.
 *
 * A new email is free; a new BVN is not. Matching on the BVN fingerprint (never
 * the BVN itself) is what makes "registered again" stop working once the person
 * reaches KYC. The phone catches it earlier, at signup, when one is given.
 */
export async function blockIfLinkedToBlocked(
  userId: string,
  opts: { bvnFingerprint?: string | null; phone?: string | null },
): Promise<string | null> {
  const or: { bvnFingerprint?: string; phone?: string }[] = [];
  if (opts.bvnFingerprint) or.push({ bvnFingerprint: opts.bvnFingerprint });
  if (opts.phone) or.push({ phone: opts.phone });
  if (or.length === 0) return null;

  const match = await prisma.user.findFirst({
    where: {
      id: { not: userId },
      status: { in: [UserStatus.BLOCKED, UserStatus.SUSPENDED] },
      OR: or,
    },
    select: { id: true },
  });
  if (!match) return null;

  await prisma.user.update({ where: { id: userId }, data: { status: UserStatus.BLOCKED } });
  await prisma.auditLog.create({
    data: {
      userId,
      action: "security.account.blocked_linked_identity",
      resourceType: "user",
      resourceId: userId,
      details: {
        linkedTo: match.id,
        matchedOn: opts.bvnFingerprint ? "bvn" : "phone",
      },
    },
  });
  await revokeAuthSessions(userId);
  invalidateAccessCache(userId);
  return match.id;
}
