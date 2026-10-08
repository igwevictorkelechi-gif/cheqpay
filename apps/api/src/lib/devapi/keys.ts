// apps/api/src/lib/devapi/keys.ts
//
// API keys: minting, storing, finding and retiring them.
//
//   - 256 random bits per key. Only the sha256 is stored: the secret is shown
//     once, at creation, and can't be recovered from the database. (A slow hash
//     buys nothing here — a 256-bit random secret can't be guessed — and a fast
//     one keeps every request's lookup an index hit.)
//   - The prefix (cp_test_sk_ / cp_live_sk_) says which mode a key works in and
//     makes keys easy to spot in a leak or a scan.
//   - Lookups are cached for 5 seconds at most, so revoking a key takes effect
//     within 5 seconds on every server.

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { prisma } from "@cheqpay/db";
import { DEFAULT_SCOPES, KEY_PATTERN, isScope } from "@cheqpay/devapi";
import { ApiError } from "../http";
import { ensureDevApiSchema } from "./ensureDevApi";
import { parseAllowEntry } from "./net";
import type { AccountRow, KeyRow, Mode, Scope } from "./types";

export const MAX_ACTIVE_KEYS_PER_MODE = 10;
export const MAX_ALLOWED_IPS = 20;

export function generateKeySecret(mode: Mode): string {
  return `cp_${mode}_sk_${randomBytes(32).toString("base64url")}`;
}

export function hashKey(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

/** The key in an `Authorization: Bearer …` header, if it is shaped like one of ours. */
export function parseBearer(header: string | null): { secret: string; mode: Mode } | null {
  if (!header) return null;
  const m = /^Bearer ([^\s]+)$/i.exec(header.trim());
  if (!m || !KEY_PATTERN.test(m[1])) return null;
  return { secret: m[1], mode: m[1].startsWith("cp_live_") ? "live" : "test" };
}

/** Normalise and validate a list of scopes. Unknown scopes are an error, not silently dropped. */
export function parseScopes(input: unknown): Scope[] {
  if (input === undefined) return [...DEFAULT_SCOPES];
  if (!Array.isArray(input) || input.length === 0) {
    throw new ApiError(400, "Choose at least one scope.", "validation_error");
  }
  const out = new Set<Scope>();
  for (const s of input) {
    if (!isScope(s)) throw new ApiError(400, `Unknown scope: ${String(s).slice(0, 40)}`, "validation_error");
    out.add(s);
  }
  return [...out];
}

/** Normalise and validate an IP allowlist. */
export function parseAllowedIps(input: unknown): string[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) throw new ApiError(400, "allowed_ips must be a list.", "validation_error");
  if (input.length > MAX_ALLOWED_IPS) {
    throw new ApiError(400, `At most ${MAX_ALLOWED_IPS} IP addresses or ranges per key.`, "validation_error");
  }
  const out = new Set<string>();
  for (const raw of input) {
    const entry = typeof raw === "string" ? parseAllowEntry(raw) : null;
    if (!entry) {
      throw new ApiError(
        400,
        `Not a valid IP address or range: ${String(raw).slice(0, 60)}. Ranges may be no wider than /16 (IPv4) or /32 (IPv6), and IPv4 addresses must be written as IPv4.`,
        "validation_error",
      );
    }
    out.add(entry);
  }
  return [...out];
}

/**
 * Rules a live key must satisfy, checked when it is created or edited and
 * again on every request (an account rule can change after a key exists).
 */
export function liveKeyProblem(account: Pick<AccountRow, "require_ip_allowlist">, scopes: readonly string[], allowedIps: readonly string[]): string | null {
  if (allowedIps.length > 0) return null;
  if (scopes.includes("cards:details")) {
    return "A live key with the cards:details scope needs an IP allowlist.";
  }
  if (account.require_ip_allowlist) return "Live keys on this account need an IP allowlist.";
  return null;
}

function validLabel(label: unknown): string {
  const s = typeof label === "string" ? label.trim() : "";
  if (s.length < 1 || s.length > 60 || /[\u0000-\u001f]/.test(s)) {
    throw new ApiError(400, "Give the key a name of up to 60 characters.", "validation_error");
  }
  return s;
}

export interface NewKeyInput {
  mode: Mode;
  label: unknown;
  scopes?: unknown;
  allowedIps?: unknown;
  expiresAt?: Date | null;
}

/**
 * Mint a key. The caller has already checked who may (the owner, with 2FA for
 * a live key) and that live mode is open to the account; this enforces the
 * rules that hold whoever asks.
 */
export async function createApiKey(account: AccountRow, input: NewKeyInput): Promise<{ key: KeyRow; secret: string }> {
  await ensureDevApiSchema();
  const label = validLabel(input.label);
  const scopes = parseScopes(input.scopes);
  const allowedIps = parseAllowedIps(input.allowedIps);
  if (input.mode === "live") {
    const problem = liveKeyProblem(account, scopes, allowedIps);
    if (problem) throw new ApiError(400, problem, "ip_allowlist_required");
  }
  const active = await prisma.$queryRawUnsafe<{ n: number }[]>(
    `SELECT count(*)::int AS n FROM dev_api_keys
      WHERE account_id = $1::uuid AND mode = $2 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`,
    account.id,
    input.mode,
  );
  if ((active[0]?.n ?? 0) >= MAX_ACTIVE_KEYS_PER_MODE) {
    throw new ApiError(409, `You can have at most ${MAX_ACTIVE_KEYS_PER_MODE} active ${input.mode} keys. Revoke one first.`, "too_many_keys");
  }

  const secret = generateKeySecret(input.mode);
  const rows = await prisma.$queryRawUnsafe<KeyRow[]>(
    `INSERT INTO dev_api_keys (id, account_id, mode, label, key_hash, last4, scopes, allowed_ips, expires_at)
     VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::text[], $8::text[], $9)
     RETURNING *`,
    randomUUID(),
    account.id,
    input.mode,
    label,
    hashKey(secret),
    secret.slice(-4),
    scopes,
    allowedIps,
    input.expiresAt ?? null,
  );
  return { key: rows[0], secret };
}

export async function listApiKeys(accountId: string): Promise<KeyRow[]> {
  await ensureDevApiSchema();
  return prisma.$queryRawUnsafe<KeyRow[]>(
    `SELECT * FROM dev_api_keys WHERE account_id = $1::uuid
       AND (revoked_at IS NULL OR revoked_at > now() - interval '90 days')
     ORDER BY created_at DESC`,
    accountId,
  );
}

export async function getApiKey(accountId: string, keyId: string): Promise<KeyRow | null> {
  const rows = await prisma.$queryRawUnsafe<KeyRow[]>(
    `SELECT * FROM dev_api_keys WHERE id = $1::uuid AND account_id = $2::uuid`,
    keyId,
    accountId,
  );
  return rows[0] ?? null;
}

export function keyIsActive(k: Pick<KeyRow, "revoked_at" | "expires_at">, now: Date = new Date()): boolean {
  return !k.revoked_at && (!k.expires_at || k.expires_at > now);
}

/** Edit a key's name, scopes or allowlist. A live key must still satisfy the live rules afterwards. */
export async function updateApiKey(
  account: AccountRow,
  keyId: string,
  patch: { label?: unknown; scopes?: unknown; allowedIps?: unknown },
): Promise<KeyRow> {
  const key = await getApiKey(account.id, keyId);
  if (!key || !keyIsActive(key)) throw new ApiError(404, "No such active key", "not_found");
  const label = patch.label === undefined ? key.label : validLabel(patch.label);
  const scopes = patch.scopes === undefined ? key.scopes : parseScopes(patch.scopes);
  const allowedIps = patch.allowedIps === undefined ? key.allowed_ips : parseAllowedIps(patch.allowedIps);
  if (key.mode === "live") {
    const problem = liveKeyProblem(account, scopes, allowedIps);
    if (problem) throw new ApiError(400, problem, "ip_allowlist_required");
  }
  const rows = await prisma.$queryRawUnsafe<KeyRow[]>(
    `UPDATE dev_api_keys SET label = $3, scopes = $4::text[], allowed_ips = $5::text[]
      WHERE id = $1::uuid AND account_id = $2::uuid AND revoked_at IS NULL
      RETURNING *`,
    keyId,
    account.id,
    label,
    scopes,
    allowedIps,
  );
  if (!rows[0]) throw new ApiError(404, "No such active key", "not_found");
  invalidateKeyCache();
  return rows[0];
}

export async function revokeApiKey(accountId: string, keyId: string, reason: string): Promise<KeyRow> {
  const rows = await prisma.$queryRawUnsafe<KeyRow[]>(
    `UPDATE dev_api_keys SET revoked_at = now(), revoked_reason = $3
      WHERE id = $1::uuid AND account_id = $2::uuid AND revoked_at IS NULL
      RETURNING *`,
    keyId,
    accountId,
    reason.slice(0, 200),
  );
  if (!rows[0]) throw new ApiError(404, "No such active key", "not_found");
  invalidateKeyCache();
  return rows[0];
}

/** Revoke every key (of one mode, or all). Returns how many were revoked. */
export async function revokeAllKeys(accountId: string, reason: string, mode?: Mode): Promise<number> {
  await ensureDevApiSchema();
  const n = await prisma.$executeRawUnsafe(
    `UPDATE dev_api_keys SET revoked_at = now(), revoked_reason = $2
      WHERE account_id = $1::uuid AND revoked_at IS NULL AND ($3::text IS NULL OR mode = $3)`,
    accountId,
    reason.slice(0, 200),
    mode ?? null,
  );
  invalidateKeyCache();
  return n;
}

/**
 * Replace a key without downtime: a new key with the same settings, while the
 * old one keeps working for `overlapHours` (0–24) so it can be swapped out of
 * every deployment. 0 retires the old key at once.
 */
export async function rollApiKey(account: AccountRow, keyId: string, overlapHours: number): Promise<{ key: KeyRow; secret: string }> {
  if (!Number.isInteger(overlapHours) || overlapHours < 0 || overlapHours > 24) {
    throw new ApiError(400, "Keep the old key for 0 to 24 hours.", "validation_error");
  }
  const old = await getApiKey(account.id, keyId);
  if (!old || !keyIsActive(old)) throw new ApiError(404, "No such active key", "not_found");
  const created = await createApiKey(account, {
    mode: old.mode,
    label: old.label,
    scopes: old.scopes,
    allowedIps: old.allowed_ips,
    expiresAt: old.expires_at,
  });
  if (overlapHours === 0) {
    await revokeApiKey(account.id, old.id, "rolled");
  } else {
    await prisma.$executeRawUnsafe(
      `UPDATE dev_api_keys SET expires_at = LEAST(COALESCE(expires_at, 'infinity'::timestamptz), now() + ($3::int * interval '1 hour'))
        WHERE id = $1::uuid AND account_id = $2::uuid`,
      old.id,
      account.id,
      overlapHours,
    );
    invalidateKeyCache();
  }
  return created;
}

// ---- Resolution, used on every request ---------------------------------------

export interface ResolvedKey {
  key: KeyRow;
  account: AccountRow;
}

const CACHE_MS = 5_000;
const CACHE_MAX = 2_000;
const cache = new Map<string, { at: number; value: ResolvedKey }>();

export function invalidateKeyCache(): void {
  cache.clear();
}

/** The key (and its account) for a secret's hash. Unknown keys are not cached. */
export async function resolveKey(hash: string, now: number = Date.now()): Promise<ResolvedKey | null> {
  const hit = cache.get(hash);
  if (hit && now - hit.at < CACHE_MS) return hit.value;
  await ensureDevApiSchema();
  const keys = await prisma.$queryRawUnsafe<KeyRow[]>(`SELECT * FROM dev_api_keys WHERE key_hash = $1`, hash);
  const key = keys[0];
  if (!key) {
    cache.delete(hash);
    return null;
  }
  const accounts = await prisma.$queryRawUnsafe<AccountRow[]>(`SELECT * FROM dev_accounts WHERE id = $1::uuid`, key.account_id);
  if (!accounts[0]) return null;
  const value = { key, account: accounts[0] };
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(hash, { at: now, value });
  return value;
}

const lastTouched = new Map<string, number>();

/** Record that a key was used, at most once a minute per key per server. */
export async function touchKey(keyId: string, ip: string | null, now: number = Date.now()): Promise<void> {
  const prev = lastTouched.get(keyId);
  if (prev && now - prev < 60_000) return;
  lastTouched.set(keyId, now);
  if (lastTouched.size > CACHE_MAX) lastTouched.delete(lastTouched.keys().next().value as string);
  await prisma.$executeRawUnsafe(
    `UPDATE dev_api_keys SET last_used_at = now(), last_used_ip = $2 WHERE id = $1::uuid`,
    keyId,
    ip,
  );
}
