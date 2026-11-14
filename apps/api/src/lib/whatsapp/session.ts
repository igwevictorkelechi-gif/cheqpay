// apps/api/src/lib/whatsapp/session.ts
//
// Which WhatsApp number may act for which CheqPay user.
//
// The rule that shapes this file: a phone number is NOT a credential. User.phone
// is nullable, never verified by any OTP flow in this codebase, stored
// un-normalised, and silently dropped when two accounts collide (see
// POST /api/me). Matching an incoming number against it would mean a SIM swap,
// or simply a recycled number, hands someone else's account over.
//
// So linking always starts from inside the signed-in app: the app asks for a
// code, the user sends that code from their own WhatsApp. Possessing the number
// proves nothing on its own; possessing the number AND a code minted by an
// authenticated session proves both halves.
//
// Codes are stored only as sha256 and burned on use, as sso_handoffs does.

import { randomInt } from "node:crypto";
import { UserStatus, prisma } from "@cheqpay/db";
import { ApiError } from "../http";
import { s256 } from "../sso";
import { ensureWhatsappSchema } from "./schema";

/** How long a link code is good for. Long enough to switch apps, short enough to not linger. */
export const LINK_CODE_TTL_MINUTES = 10;

// No 0/O/1/I/L — these get read off a screen and typed into a chat.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;

export const LINK_CODE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;

function newCode(): string {
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

/** Meta gives numbers in E.164 without the +. Keep one spelling everywhere. */
export function normaliseWaId(waId: string): string {
  return waId.replace(/[^\d]/g, "");
}

export interface LinkCode {
  code: string;
  expiresInMinutes: number;
  /** Deep link that opens the bot's chat with the message pre-typed. */
  deepLink: string | null;
}

/**
 * Mint a link code for a signed-in user. Any unspent code they already hold is
 * dropped, so the most recent one in front of them is the only one that works.
 */
export async function createLinkCode(userId: string): Promise<LinkCode> {
  await ensureWhatsappSchema();
  const code = newCode();
  await prisma.$executeRawUnsafe(
    `DELETE FROM wa_link_codes WHERE user_id = $1::uuid AND used_at IS NULL`,
    userId,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO wa_link_codes (code_hash, user_id, expires_at)
     VALUES ($1, $2::uuid, now() + make_interval(mins => $3::int))`,
    s256(code),
    userId,
    LINK_CODE_TTL_MINUTES,
  );
  if (Math.random() < 0.05) {
    void prisma
      .$executeRawUnsafe(`DELETE FROM wa_link_codes WHERE created_at < now() - interval '1 day'`)
      .catch(() => undefined);
  }
  return { code, expiresInMinutes: LINK_CODE_TTL_MINUTES, deepLink: botDeepLink(code) };
}

/** wa.me link that opens our chat with "LINK ABC123" ready to send. */
export function botDeepLink(code: string): string | null {
  const number = process.env.WHATSAPP_BOT_NUMBER?.replace(/[^\d]/g, "");
  if (!number) return null;
  return `https://wa.me/${number}?text=${encodeURIComponent(`LINK ${code}`)}`;
}

export interface LinkOutcome {
  userId: string;
  /** The number was already linked to this same user; nothing changed. */
  alreadyLinked: boolean;
}

/**
 * Spend a code and bind the number to the account.
 *
 * The code is burned whether or not the rest succeeds, so a wrong guess cannot
 * be retried and codes cannot be ground down. Returns null when the code is
 * unknown, expired or already spent — the caller must not say which, or the
 * reply becomes an oracle.
 */
export async function redeemLinkCode(waId: string, code: string): Promise<LinkOutcome | null> {
  await ensureWhatsappSchema();
  const id = normaliseWaId(waId);
  if (!id || !LINK_CODE.test(code)) return null;

  const rows = await prisma.$queryRawUnsafe<{ user_id: string }[]>(
    `UPDATE wa_link_codes SET used_at = now()
      WHERE code_hash = $1 AND used_at IS NULL AND expires_at > now()
      RETURNING user_id`,
    s256(code),
  );
  const userId = rows[0]?.user_id;
  if (!userId) return null;

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { status: true } });
  if (!user || user.status === UserStatus.BLOCKED || user.status === UserStatus.SUSPENDED) return null;

  const existing = await prisma.$queryRawUnsafe<{ user_id: string }[]>(
    `SELECT user_id FROM wa_links WHERE wa_id = $1 AND revoked_at IS NULL`,
    id,
  );
  if (existing[0]?.user_id === userId) return { userId, alreadyLinked: true };

  // One live number per user and one live user per number: revoke whatever
  // either side held before taking the new binding.
  await prisma.$executeRawUnsafe(
    `UPDATE wa_links SET revoked_at = now()
      WHERE revoked_at IS NULL AND (wa_id = $1 OR user_id = $2::uuid)`,
    id,
    userId,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO wa_links (wa_id, user_id, linked_at, last_seen_at)
     VALUES ($1, $2::uuid, now(), now())
     ON CONFLICT (wa_id) DO UPDATE
       SET user_id = EXCLUDED.user_id, linked_at = now(), last_seen_at = now(), revoked_at = NULL`,
    id,
    userId,
  );
  return { userId, alreadyLinked: false };
}

/**
 * The user this number may act for, or null.
 *
 * Also re-checks account status every time: a blocked or suspended account must
 * lose the chat channel at once, not at the next link.
 */
export async function resolveLink(waId: string): Promise<{ userId: string } | null> {
  await ensureWhatsappSchema();
  const id = normaliseWaId(waId);
  if (!id) return null;
  const rows = await prisma.$queryRawUnsafe<{ user_id: string }[]>(
    `SELECT user_id FROM wa_links WHERE wa_id = $1 AND revoked_at IS NULL`,
    id,
  );
  const userId = rows[0]?.user_id;
  if (!userId) return null;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { status: true } });
  if (!user || user.status === UserStatus.BLOCKED || user.status === UserStatus.SUSPENDED) return null;
  void prisma
    .$executeRawUnsafe(`UPDATE wa_links SET last_seen_at = now() WHERE wa_id = $1`, id)
    .catch(() => undefined);
  return { userId };
}

/** Unlink by number (the user sent STOP). Returns the user that was unlinked. */
export async function unlinkByWaId(waId: string): Promise<string | null> {
  await ensureWhatsappSchema();
  const rows = await prisma.$queryRawUnsafe<{ user_id: string }[]>(
    `UPDATE wa_links SET revoked_at = now()
      WHERE wa_id = $1 AND revoked_at IS NULL RETURNING user_id`,
    normaliseWaId(waId),
  );
  return rows[0]?.user_id ?? null;
}

/** Unlink from the app's Security settings. */
export async function unlinkByUser(userId: string): Promise<boolean> {
  await ensureWhatsappSchema();
  const rows = await prisma.$queryRawUnsafe<{ wa_id: string }[]>(
    `UPDATE wa_links SET revoked_at = now()
      WHERE user_id = $1::uuid AND revoked_at IS NULL RETURNING wa_id`,
    userId,
  );
  return rows.length > 0;
}

/** What Security settings shows. */
export async function linkStatus(userId: string): Promise<{ linked: boolean; maskedNumber: string | null; linkedAt: Date | null }> {
  await ensureWhatsappSchema();
  const rows = await prisma.$queryRawUnsafe<{ wa_id: string; linked_at: Date }[]>(
    `SELECT wa_id, linked_at FROM wa_links WHERE user_id = $1::uuid AND revoked_at IS NULL`,
    userId,
  );
  const row = rows[0];
  if (!row) return { linked: false, maskedNumber: null, linkedAt: null };
  return { linked: true, maskedNumber: maskNumber(row.wa_id), linkedAt: row.linked_at };
}

/** Never echo a full number back; the last 4 are enough to recognise your own. */
export function maskNumber(waId: string): string {
  const id = normaliseWaId(waId);
  return id.length <= 4 ? "••••" : `••• ••• ${id.slice(-4)}`;
}

export function assertLinked(link: { userId: string } | null): asserts link is { userId: string } {
  if (!link) throw new ApiError(403, "This WhatsApp number isn't connected to a CheqPay account.", "wa_not_linked");
}
