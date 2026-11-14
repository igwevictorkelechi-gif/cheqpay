// apps/api/src/lib/whatsapp/verify.ts
//
// Meta signs every webhook delivery with `X-Hub-Signature-256: sha256=<hex>`,
// an HMAC-SHA256 of the EXACT request bytes keyed by the Meta app secret. The
// WhatsApp Business account hangs off the same Meta app as the social
// publisher, so META_APP_SECRET is the key — there is no separate secret.
//
// Verify against the raw body, never a re-serialised object: JSON.stringify
// will not reproduce Meta's byte order or spacing, so a round-tripped body
// fails a signature that is actually valid.

import { createHmac, timingSafeEqual } from "node:crypto";

export const SIGNATURE_HEADER = "x-hub-signature-256";

/** The Meta app secret, or null when it is not configured. */
export function whatsappAppSecret(): string | null {
  const secret = process.env.META_APP_SECRET?.trim();
  return secret ? secret : null;
}

/**
 * True when `header` is Meta's signature over `rawBody`.
 *
 * Fails CLOSED: no secret configured, no header, or a malformed header all
 * return false. An unsigned request is never processed — the alternative is a
 * public endpoint that anyone can use to impersonate any customer.
 */
export function verifyWhatsappSignature(
  rawBody: string,
  header: string | null,
  secret: string | null = whatsappAppSecret(),
): boolean {
  if (!secret || !header) return false;
  const got = header.startsWith("sha256=") ? header.slice(7) : header;
  if (!/^[0-9a-f]{64}$/i.test(got)) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(got.toLowerCase(), "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Meta's one-off subscription handshake: it calls the webhook with
 * `hub.mode=subscribe` and a token typed into its setup form, and expects
 * `hub.challenge` echoed back as plain text. Returns the challenge to echo, or
 * null to refuse.
 */
export function verifySubscription(url: URL): string | null {
  const configured = process.env.WHATSAPP_VERIFY_TOKEN?.trim();
  if (!configured) return null;
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (mode !== "subscribe" || !token || !challenge) return null;
  const a = Buffer.from(configured);
  const b = Buffer.from(token);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return challenge;
}
