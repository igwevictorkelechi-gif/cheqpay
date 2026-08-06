import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Encryption for regulated personal data — currently the BVN.
 *
 * Nigeria's Money Laundering (Prevention and Prohibition) Act 2022 requires
 * customer identification records to be retained and producible to the
 * authorities. That rules out storing only a hash: a hash can confirm a BVN you
 * already suspect, but cannot answer "what is this account's BVN?".
 *
 * So the BVN is stored three ways, each for a different job:
 *
 *   bvnCiphertext  AES-256-GCM, recoverable with the key. What gets produced to
 *                  a regulator. Useless to anyone who steals only the database.
 *   bvnHash        HMAC-SHA256, deterministic. Makes "find the account with this
 *                  BVN" an indexed lookup instead of decrypting every row.
 *   bvnLast4       Plaintext, for display in the admin dashboard so staff can
 *                  confirm a match without exposing the full number.
 *
 * The key lives in PII_ENCRYPTION_KEY, outside the database. A database backup
 * on its own therefore discloses no BVNs. Losing the key means losing the
 * ability to produce them — back it up somewhere the database is not.
 */

const VERSION = "v1";
const ALGO = "aes-256-gcm";
const IV_BYTES = 12; // GCM standard

let cachedKey: Buffer | null = null;

/** True when PII encryption is configured. */
export function isPiiEncryptionConfigured(): boolean {
  const raw = process.env.PII_ENCRYPTION_KEY;
  return typeof raw === "string" && raw.trim().length > 0;
}

/**
 * The 32-byte key, decoded from base64. Throws rather than falling back: a
 * silent fallback here would mean writing BVNs in a form we cannot recover, or
 * worse, in plaintext.
 */
function key(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.PII_ENCRYPTION_KEY?.trim();
  if (!raw) {
    throw new Error(
      "PII_ENCRYPTION_KEY is not set. Generate one with: openssl rand -base64 32"
    );
  }
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) {
    throw new Error(
      `PII_ENCRYPTION_KEY must decode to 32 bytes (got ${buf.length}). Generate one with: openssl rand -base64 32`
    );
  }
  cachedKey = buf;
  return cachedKey;
}

/** Reset the cached key. Tests only. */
export function resetPiiKeyCache(): void {
  cachedKey = null;
}

/**
 * Encrypt a value. Output is `v1:<iv>:<tag>:<ciphertext>`, all base64.
 * The version prefix exists so the key can be rotated later without guessing
 * how existing rows were written.
 */
export function encryptPii(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(":");
}

/**
 * Decrypt a value written by `encryptPii`. Throws if the ciphertext has been
 * tampered with — GCM authenticates, so a modified row fails loudly rather than
 * returning plausible garbage.
 */
export function decryptPii(encoded: string): string {
  const parts = encoded.split(":");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("Unrecognized ciphertext format");
  }
  const [, ivB64, tagB64, ctB64] = parts;
  const decipher = createDecipheriv(ALGO, key(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/**
 * Deterministic, searchable fingerprint. Same input always yields the same
 * output, so it can be indexed and matched — which plain encryption cannot,
 * because a fresh IV makes every ciphertext different.
 *
 * HMAC rather than a bare hash: a BVN is an 11-digit number, so an unkeyed hash
 * of every possible BVN could be precomputed in minutes. The key makes that
 * table useless without also stealing the key.
 */
export function fingerprintPii(value: string): string {
  return createHmac("sha256", key()).update(value.trim()).digest("hex");
}

/** Constant-time comparison of two fingerprints. */
export function fingerprintMatches(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** Last 4 digits, for display. Returns "" when there is nothing to show. */
export function last4(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : "";
}
