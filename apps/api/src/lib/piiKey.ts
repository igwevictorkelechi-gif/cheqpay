/**
 * Classifying the PII key, kept apart from the crypto that uses it.
 *
 * lib/pii.ts imports `node:crypto`, which the Edge runtime does not have.
 * instrumentation.ts is compiled for BOTH runtimes, so importing pii.ts from it
 * — even lazily, behind a runtime guard — makes webpack pull `node:crypto` into
 * the Edge bundle and the build fails with UnhandledSchemeError. The existing
 * lazy imports there get away with it only because none of them reach a `node:`
 * scheme.
 *
 * Validating the key needs no crypto at all: it is a base64 length check. So it
 * lives here, importable from anywhere, and pii.ts re-exports it so callers have
 * one place to look.
 */

/**
 * Whether the key is missing, present-but-unusable, or good.
 *
 * "unset" and "invalid" need different fixes — generate one, versus replace the
 * one you generated wrongly — so callers must be able to tell them apart.
 */
export type PiiKeyStatus = "ok" | "unset" | "invalid";

/**
 * Classify the configured key without throwing.
 *
 * The distinction earns its place because the failure is otherwise silent. The
 * key must be base64 decoding to exactly 32 bytes, and the natural mistake — a
 * 32-*character* random string — decodes to 24 and cannot be used. This used to
 * be a bare "is the variable non-empty?" check, so a malformed key reported
 * itself as configured and then threw on first use, deep inside a best-effort
 * block that swallowed it.
 */
export function piiKeyStatus(): PiiKeyStatus {
  const raw = process.env.PII_ENCRYPTION_KEY?.trim();
  if (!raw) return "unset";
  try {
    return Buffer.from(raw, "base64").length === 32 ? "ok" : "invalid";
  } catch {
    return "invalid";
  }
}
