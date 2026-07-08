import { createHmac, randomBytes } from "node:crypto";
import { prisma } from "@cheqpay/db";

/**
 * Minimal RFC 6238 TOTP (SHA-1, 6 digits, 30s period) — the scheme Google
 * Authenticator / Authy / 1Password use. The admin scans a QR once; sensitive
 * admin actions (balance adjustments) then require a fresh 6-digit code.
 *
 * Secrets live in platform_settings:
 *   admin_totp_secret_pending — generated at setup, not yet confirmed
 *   admin_totp_secret         — active secret (activation moves pending here)
 *   admin_totp_last_counter   — last accepted timestep, to block replay
 */

const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const PERIOD_S = 30;
const DIGITS = 6;

const KEY_PENDING = "admin_totp_secret_pending";
const KEY_ACTIVE = "admin_totp_secret";
const KEY_LAST = "admin_totp_last_counter";

function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | B32_ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function hotp(secret: Buffer, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", secret).update(msg).digest();
  const off = h[h.length - 1] & 0xf;
  const code =
    (((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3]) % 10 ** DIGITS;
  return String(code).padStart(DIGITS, "0");
}

/** Check `code` against `secretB32` (±1 timestep). Returns the matched
 *  counter, or null. Pure — replay protection is the caller's job. */
export function verifyTotpCode(code: string, secretB32: string, window = 1): number | null {
  const clean = code.replace(/\D/g, "");
  if (clean.length !== DIGITS) return null;
  const secret = base32Decode(secretB32);
  const now = Math.floor(Date.now() / 1000 / PERIOD_S);
  for (let i = -window; i <= window; i++) {
    if (hotp(secret, now + i) === clean) return now + i;
  }
  return null;
}

// --- DB-backed admin OTP state ------------------------------------------------

async function getSetting(key: string): Promise<string | null> {
  const row = await prisma.platformSetting.findUnique({ where: { key } });
  return row?.value ?? null;
}
async function putSetting(key: string, value: string, updatedBy?: string) {
  await prisma.platformSetting.upsert({
    where: { key },
    update: { value, updatedBy },
    create: { key, value, updatedBy },
  });
}

export async function isAdminOtpConfigured(): Promise<boolean> {
  return !!(await getSetting(KEY_ACTIVE));
}

/** Start (or restart) setup: mint a pending secret and return the otpauth URI
 *  the admin scans into their authenticator app. */
export async function beginAdminOtpSetup(updatedBy?: string): Promise<{
  secret: string;
  otpauthUrl: string;
}> {
  const secret = base32Encode(randomBytes(20));
  await putSetting(KEY_PENDING, secret, updatedBy);
  const label = encodeURIComponent("CheqPay Admin");
  const otpauthUrl = `otpauth://totp/${label}?secret=${secret}&issuer=CheqPay&digits=${DIGITS}&period=${PERIOD_S}`;
  return { secret, otpauthUrl };
}

/** Confirm setup with a code from the app; promotes pending -> active. */
export async function activateAdminOtp(code: string, updatedBy?: string): Promise<boolean> {
  const pending = await getSetting(KEY_PENDING);
  if (!pending) return false;
  const counter = verifyTotpCode(code, pending);
  if (counter === null) return false;
  await putSetting(KEY_ACTIVE, pending, updatedBy);
  await putSetting(KEY_LAST, String(counter), updatedBy);
  await prisma.platformSetting.delete({ where: { key: KEY_PENDING } }).catch(() => undefined);
  return true;
}

/** Verify a code against the ACTIVE secret with one-time-use enforcement:
 *  a given timestep can never authorize twice (blocks shoulder-surf replay). */
export async function consumeAdminOtp(code: string): Promise<boolean> {
  const secret = await getSetting(KEY_ACTIVE);
  if (!secret) return false;
  const counter = verifyTotpCode(code, secret);
  if (counter === null) return false;
  const last = Number((await getSetting(KEY_LAST)) ?? 0);
  if (counter <= last) return false; // already used (or older window)
  await putSetting(KEY_LAST, String(counter));
  return true;
}
