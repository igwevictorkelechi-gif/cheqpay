// apps/api/src/lib/tatum/webhook.ts
//
// Authenticating inbound Tatum notifications.
//
// Tatum signs each delivery with an HMAC of the raw body and sends the digest in
// the `x-payload-hash` header. We verify against the raw bytes — the body must
// never be re-serialized before checking, or the digest stops matching.
//
// We accept the digest in any of the HMAC variants Tatum has shipped
// (SHA-512/SHA-256, base64/hex). This is not a weakening: producing ANY of them
// requires the shared secret, so an attacker gains nothing, while we avoid the
// far worse failure of rejecting genuine deposits over an encoding mismatch and
// leaving real money uncredited.

import { createHmac, timingSafeEqual } from "node:crypto";

export function tatumWebhookSecret(): string | undefined {
  const s = process.env.TATUM_WEBHOOK_SECRET?.trim();
  return s ? s : undefined;
}

export function readPayloadHash(headers: Headers): string | null {
  const h = headers.get("x-payload-hash") ?? headers.get("X-Payload-Hash");
  return h && h.trim() ? h.trim() : null;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * True when `digest` is a valid HMAC of `rawBody` under the configured secret.
 *
 * Returns false when no secret is configured: an unauthenticated crediting
 * endpoint is not something to fail open on.
 */
export function verifyTatumSignature(rawBody: string, digest: string): boolean {
  const secret = tatumWebhookSecret();
  if (!secret) return false;

  for (const algo of ["sha512", "sha256"] as const) {
    for (const enc of ["base64", "hex"] as const) {
      const expected = createHmac(algo, secret).update(rawBody, "utf8").digest(enc);
      if (safeEqual(expected, digest)) return true;
    }
  }
  return false;
}
