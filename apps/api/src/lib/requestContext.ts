/**
 * Who is calling, from where, on what.
 *
 * The database has had an `ip_address` column on the audit log since the
 * beginning and nothing ever wrote to it. These helpers are what fill it in,
 * and what feed the login/device history in the admin Security section.
 */

/**
 * The caller's IP.
 *
 * Every request reaches the API through a proxy — Vercel's edge today, Caddy on
 * a VPS tomorrow — so the socket address is the proxy, not the user. The real
 * address is the FIRST entry in `x-forwarded-for`; later entries are the
 * intermediate hops.
 *
 * A client can forge `x-forwarded-for`, and our proxies append rather than
 * replace, so treat this as evidence, not proof. It is good enough to answer
 * "did this account suddenly start logging in from somewhere else?" — which is
 * the fraud question it exists for.
 */
export function clientIp(req: Request): string | null {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return normalizeIp(first);
  }
  // Platform-specific fallbacks, in decreasing order of trustworthiness.
  for (const header of ["cf-connecting-ip", "x-real-ip", "x-vercel-forwarded-for"]) {
    const v = req.headers.get(header);
    if (v) return normalizeIp(v.trim());
  }
  return null;
}

/** IPv4-mapped IPv6 (`::ffff:1.2.3.4`) reads as noise in a report. */
function normalizeIp(ip: string): string {
  return ip.startsWith("::ffff:") ? ip.slice(7) : ip;
}

/** Raw user agent, truncated — some agents are absurdly long. */
export function userAgent(req: Request): string | null {
  const ua = req.headers.get("user-agent");
  return ua ? ua.slice(0, 400) : null;
}

/**
 * A human-readable device label, e.g. "iPhone · Safari".
 *
 * Deliberately crude rather than a UA-parsing dependency: this is read by a
 * person deciding whether a login looks like the account's owner, and "iPhone ·
 * Safari" answers that as well as an exact version string would. The full user
 * agent is stored alongside for when the detail actually matters.
 */
export function deviceLabel(ua: string | null): string | null {
  if (!ua) return null;

  const os =
    /iPhone/i.test(ua) ? "iPhone"
    : /iPad/i.test(ua) ? "iPad"
    : /Android/i.test(ua) ? "Android"
    : /Windows/i.test(ua) ? "Windows"
    : /Mac OS X|Macintosh/i.test(ua) ? "Mac"
    : /Linux/i.test(ua) ? "Linux"
    : null;

  // Order matters: Edge and Chrome both claim "Safari", Chrome claims nothing
  // useful against Edge. Check the most specific first.
  const app =
    /CheqPay/i.test(ua) ? "CheqPay app"
    : /Expo/i.test(ua) ? "CheqPay app"
    : /Edg\//i.test(ua) ? "Edge"
    : /OPR\/|Opera/i.test(ua) ? "Opera"
    : /Firefox\//i.test(ua) ? "Firefox"
    : /Chrome\//i.test(ua) ? "Chrome"
    : /Safari\//i.test(ua) ? "Safari"
    : null;

  if (os && app) return `${os} · ${app}`;
  return os ?? app ?? "Unknown device";
}

/** "mobile" when the call came from the Expo app, otherwise "web". */
export function platformOf(ua: string | null): string {
  if (!ua) return "unknown";
  return /Expo|CheqPay|okhttp|CFNetwork/i.test(ua) ? "mobile" : "web";
}

/** Everything about the caller, in one call. */
export function requestContext(req: Request) {
  const ua = userAgent(req);
  return {
    ip: clientIp(req),
    userAgent: ua,
    device: deviceLabel(ua),
    platform: platformOf(ua),
    path: safePath(req),
  };
}

/** The route being called, for "last action". Query strings can hold secrets. */
function safePath(req: Request): string {
  try {
    return new URL(req.url).pathname;
  } catch {
    return "";
  }
}
