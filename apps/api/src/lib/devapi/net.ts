import { BlockList, isIP } from "node:net";

/**
 * IP handling for the developer platform: per-key allowlists, and (for webhook
 * delivery) refusing to connect anywhere that isn't the public internet.
 *
 * Built on node's BlockList rather than hand-rolled prefix maths, so IPv6 and
 * CIDR edge cases are the runtime's problem, not ours.
 */

export type Family = "ipv4" | "ipv6";

/** Strip brackets, a zone id and the IPv4-mapped prefix; lowercase. Null if not an IP. */
export function normalizeIp(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let ip = raw.trim().toLowerCase();
  if (ip.startsWith("[") && ip.endsWith("]")) ip = ip.slice(1, -1);
  const zone = ip.indexOf("%");
  if (zone !== -1) ip = ip.slice(0, zone);
  if (ip.startsWith("::ffff:") && isIP(ip.slice(7)) === 4) ip = ip.slice(7);
  return isIP(ip) ? ip : null;
}

/**
 * The caller's IP, for decisions that must not be spoofable (key allowlists,
 * the failed-auth block). On Vercel only the headers the platform itself sets
 * are read — it overwrites them, so a client can't choose its own address. Off
 * Vercel (local, tests) the usual forwarded headers are used.
 */
export function trustedClientIp(req: Request): string | null {
  const h = req.headers;
  if (process.env.VERCEL) {
    return normalizeIp(h.get("x-vercel-forwarded-for")?.split(",")[0]) ?? normalizeIp(h.get("x-real-ip"));
  }
  return (
    normalizeIp(h.get("x-vercel-forwarded-for")?.split(",")[0]) ??
    normalizeIp(h.get("x-real-ip")) ??
    normalizeIp(h.get("x-forwarded-for")?.split(",")[0])
  );
}

function familyOf(ip: string): Family {
  return isIP(ip) === 6 ? "ipv6" : "ipv4";
}

/**
 * A valid allowlist entry ("203.0.113.7", "203.0.113.0/24", "2001:db8::/48")
 * in canonical form, or null. Over-broad ranges are refused: an allowlist of
 * 0.0.0.0/0 is no allowlist at all, so anything wider than /16 (IPv4) or /32
 * (IPv6) is rejected.
 */
export function parseAllowEntry(raw: string): string | null {
  const [addrPart, prefixPart, extra] = raw.trim().split("/");
  if (extra !== undefined) return null;
  const ip = normalizeIp(addrPart);
  if (!ip) return null;
  const fam = familyOf(ip);
  if (prefixPart === undefined) return ip;
  if (!/^\d{1,3}$/.test(prefixPart)) return null;
  const prefix = Number(prefixPart);
  const max = fam === "ipv4" ? 32 : 128;
  const min = fam === "ipv4" ? 16 : 32;
  if (prefix > max || prefix < min) return null;
  return `${ip}/${prefix}`;
}

/** Does `ip` fall inside any allowlist entry? Entries are assumed already parsed. */
export function ipAllowed(ip: string | null, entries: readonly string[]): boolean {
  const addr = normalizeIp(ip);
  if (!addr) return false;
  const list = new BlockList();
  for (const e of entries) {
    const [a, p] = e.split("/");
    const fam = familyOf(a);
    if (p === undefined) list.addAddress(a, fam);
    else list.addSubnet(a, Number(p), fam);
  }
  return list.check(addr, familyOf(addr));
}

// Everything that is not the public internet. Webhook delivery refuses these so
// an endpoint URL can't be used to reach our own network, a cloud metadata
// service or anything else that trusts "internal" callers.
//
// IPv4-mapped IPv6 (::ffff:a.b.c.d, in any spelling) needs no rule of its own:
// node's BlockList checks a mapped address against the IPv4 rules. (A rule for
// ::ffff:0:0/96 would, by the same mapping, match every IPv4 address.)
const RESERVED = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  RESERVED.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96], // NAT64
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 23], // IETF protocol assignments, Teredo
  ["2001:db8::", 32],
  ["2002::", 16], // 6to4
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
] as const) {
  RESERVED.addSubnet(net, prefix, "ipv6");
}

/** True only for a routable, public unicast address. */
export function isPublicAddress(raw: string): boolean {
  const ip = normalizeIp(raw);
  if (!ip) return false;
  return !RESERVED.check(ip, familyOf(ip));
}
