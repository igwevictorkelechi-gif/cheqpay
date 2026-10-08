import { KEY_LIKE } from "@cheqpay/devapi";

/**
 * What a request log may keep.
 *
 * Logs are an allowlist, not a blocklist: each route names the top-level body
 * fields worth seeing in the dashboard (amount, currency, reference…), and
 * everything else is dropped. Nested objects (an address, an identity block)
 * are never logged. A BVN or card number can't leak through a field nobody
 * thought to block, because only fields somebody chose to keep are kept.
 *
 * `scrubSensitive` is the backstop on the strings that are kept: anything
 * shaped like a BVN, a card number, a secret key or a webhook secret is masked
 * even if it turned up in an allowed field.
 */

const MAX_STRING = 200;

export function redactForLog(body: unknown, allow: readonly string[]): Record<string, unknown> | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const out: Record<string, unknown> = {};
  for (const key of allow) {
    if (!(key in (body as Record<string, unknown>))) continue;
    const v = (body as Record<string, unknown>)[key];
    if (typeof v === "string") out[key] = scrubSensitive(v.slice(0, MAX_STRING));
    else if (typeof v === "number" || typeof v === "boolean" || v === null) out[key] = v;
    else out[key] = "[omitted]";
  }
  return out;
}

/** Luhn check, for telling a card number from any other long digit run. */
export function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return digits.length > 0 && sum % 10 === 0;
}

const KEY_GLOBAL = new RegExp(KEY_LIKE.source, "g");

/** Mask secrets, BVN-shaped numbers and card-shaped numbers inside free text. */
export function scrubSensitive(s: string): string {
  return (
    s
      .replace(KEY_GLOBAL, "cp_•••_sk_[redacted]")
      .replace(/whsec_[A-Za-z0-9+/=_-]{8,}/g, "whsec_[redacted]")
      // Card numbers may be written with spaces or dashes between groups.
      .replace(/\b\d(?:[ -]?\d){12,18}\b/g, (m) => {
        const digits = m.replace(/[ -]/g, "");
        return digits.length >= 13 && digits.length <= 19 && luhnValid(digits) ? `[card •••• ${digits.slice(-4)}]` : m;
      })
      // A bare 11-digit run is how a BVN or NIN looks (a Nigerian phone number
      // too, which is personal data as well, so masking it is fine).
      .replace(/\b\d{11}\b/g, (m) => `[•••••••${m.slice(-4)}]`)
  );
}
