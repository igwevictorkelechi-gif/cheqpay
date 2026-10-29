/**
 * Pull a CheqPay username out of a scanned QR or a deep link.
 *
 * Accepts everything a CheqPay pay code can be:
 *   - `https://mycheqpay.com/pay?u=victor&c=<token>`  (the shared/universal link)
 *   - `cheqpay://pay?u=victor`                          (the app scheme)
 *   - `https://mycheqpay.com/pay/victor`                (legacy path form)
 *   - `@victor` or `victor`                             (a bare handle)
 *
 * Pure string work (no `URL`, which Hermes only half-implements), and it never
 * trusts the token here — the username is all the app needs to start a transfer,
 * and the recipient is confirmed by a server lookup before any money moves.
 * Returns the username, or null when the value isn't a CheqPay code.
 */
export function parsePayCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  // Query form `/pay?u=<username>` — only trust `u=` on a pay link.
  if (/pay\b/i.test(s)) {
    const q = s.match(/[?&]u=([a-zA-Z0-9_]{3,20})(?:[&#]|$)/);
    if (q) return q[1];
  }
  // Path form `/pay/<username>` or `cheqpay://pay/<username>`.
  const viaPath = s.match(/(?:cheqpay:\/\/|\/)pay\/([a-zA-Z0-9_]{3,20})(?:[/?#]|$)/i);
  if (viaPath) return viaPath[1];
  const bare = s.replace(/^@+/, "");
  if (/^[a-zA-Z0-9_]{3,20}$/.test(bare)) return bare;
  return null;
}
