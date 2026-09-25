// Links that come from somewhere else — a query string, an admin, a partner —
// are checked before the app follows them.

/**
 * A path on this site, or null. Refuses anything that would leave the site:
 * `//evil.com` and `/\evil.com` both start with "/" but browsers treat them as
 * another host, which turns "continue to /next" into a phishing redirect.
 */
export function safeInternalPath(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim();
  if (!s.startsWith("/") || s.startsWith("//") || s.startsWith("/\\")) return null;
  try {
    const base = typeof window === "undefined" ? "https://mycheqpay.com" : window.location.origin;
    const u = new URL(s, base);
    return u.origin === base ? `${u.pathname}${u.search}${u.hash}` : null;
  } catch {
    return null;
  }
}

/** An https link, or null — never `javascript:` or `data:` in an href. */
export function safeHttpsUrl(raw: string | null | undefined): string | null {
  try {
    const u = new URL((raw ?? "").trim());
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}
