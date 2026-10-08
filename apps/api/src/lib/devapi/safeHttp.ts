// apps/api/src/lib/devapi/safeHttp.ts
//
// Outbound HTTPS to an address a developer chose (their webhook endpoint),
// without letting that choice reach anything but the public internet.
//
// Two layers:
//
//   1. webhookUrlProblem — refuses, when the URL is saved, anything that isn't
//      plain https://<public domain>/…: IP literals in any spelling (the URL
//      parser already turns 0x7f.1 or 2130706433 into 127.0.0.1), credentials,
//      odd ports, single-label and reserved names.
//
//   2. safeLookup — runs at CONNECT time, on every delivery. It resolves the
//      name itself and refuses if ANY answer is private, loopback, link-local,
//      CGNAT, a metadata address or otherwise reserved (IPv4 and IPv6, mapped
//      forms included — see net.ts). Checking when we connect, rather than when
//      the URL was saved, is what defeats DNS rebinding: a name that answered
//      with a public address yesterday and 169.254.169.254 today is refused
//      today.
//
// Redirects are never followed (node:https doesn't), a delivery gives up after
// 10 seconds, and at most 4 KB of the response is read.

import dns from "node:dns";
import https from "node:https";
import { isIP } from "node:net";
import { isPublicAddress } from "./net";

export const MAX_URL_LENGTH = 2048;

/** Suffixes that never name a public host. */
const NON_PUBLIC_SUFFIXES = [
  ".localhost",
  ".local",
  ".localdomain",
  ".internal",
  ".intranet",
  ".private",
  ".lan",
  ".home",
  ".corp",
  ".home.arpa",
  ".arpa",
  ".test",
  ".invalid",
  ".example",
  ".onion",
];

/** Why a webhook URL is refused, or null when it is acceptable. */
export function webhookUrlProblem(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0) return "is missing";
  if (raw.length > MAX_URL_LENGTH) return "is too long";
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return "isn't a valid URL";
  }
  if (u.protocol !== "https:") return "must start with https://";
  if (u.username || u.password) return "must not contain a username or password";
  if (u.port && u.port !== "443") return "must use the standard HTTPS port";
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (isIP(host.replace(/^\[|\]$/g, ""))) return "must use a domain name, not an IP address";
  if (!/^[a-z0-9.-]+$/.test(host)) return "must be a plain domain name";
  if (!host.includes(".")) return "must be a full domain name";
  if (host === "localhost" || NON_PUBLIC_SUFFIXES.some((s) => host.endsWith(s))) return "must be a public domain";
  if (host.split(".").some((label) => label.length === 0 || label.length > 63)) return "isn't a valid domain name";
  return null;
}

type Resolver = (
  hostname: string,
  options: dns.LookupAllOptions,
  callback: (err: NodeJS.ErrnoException | null, addresses: dns.LookupAddress[]) => void,
) => void;

const systemResolver: Resolver = (hostname, options, callback) => dns.lookup(hostname, options, callback);

/**
 * A `lookup` for node:https that refuses to connect to anything non-public.
 * Every answer is checked, not just the first: a name answering with one public
 * and one private address is refused outright.
 */
export function makeSafeLookup(resolve: Resolver = systemResolver) {
  return function safeLookup(
    hostname: string,
    options: { family?: number | string; all?: boolean } | number | undefined,
    callback: (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void,
  ): void {
    const opts = typeof options === "object" && options ? options : {};
    const family = typeof opts.family === "number" ? opts.family : opts.family === "IPv6" ? 6 : opts.family === "IPv4" ? 4 : 0;
    resolve(hostname, { all: true, verbatim: true, family }, (err, addresses) => {
      if (err) return callback(err, "", 0);
      if (!addresses?.length || addresses.some((a) => !isPublicAddress(a.address))) {
        const refused = new Error(`refused to connect: ${hostname} resolves to a private or reserved address`) as NodeJS.ErrnoException;
        refused.code = "EADDRNOTPUBLIC";
        return callback(refused, "", 0);
      }
      if (opts.all) return callback(null, addresses);
      callback(null, addresses[0].address, addresses[0].family);
    });
  };
}

export const safeLookup = makeSafeLookup();

export interface PostResult {
  status: number;
  /** At most `maxResponseBytes` of the response body. */
  body: string;
}

/**
 * POST a JSON body over HTTPS to a public address only. Resolves with the
 * status for any HTTP response (redirects included — they count as failures to
 * the caller); rejects on a refused address, a TLS or network error, or a
 * timeout.
 */
export function safePostJson(
  url: string,
  body: string,
  headers: Record<string, string>,
  opts: { timeoutMs?: number; maxResponseBytes?: number; lookup?: ReturnType<typeof makeSafeLookup> } = {},
): Promise<PostResult> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const maxBytes = opts.maxResponseBytes ?? 4096;
  const problem = webhookUrlProblem(url);
  if (problem) return Promise.reject(new Error(`URL ${problem}`));
  const u = new URL(url);

  return new Promise<PostResult>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const req = https.request(
      {
        protocol: "https:",
        hostname: u.hostname,
        port: 443,
        path: `${u.pathname}${u.search}`,
        method: "POST",
        servername: u.hostname,
        agent: false,
        lookup: (opts.lookup ?? safeLookup) as never,
        headers: {
          ...headers,
          "content-type": "application/json",
          "content-length": String(Buffer.byteLength(body)),
          "user-agent": "CheqPay-Webhooks/1.0",
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        const done = () =>
          finish(() => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8").slice(0, maxBytes) }));
        res.on("data", (chunk: Buffer) => {
          if (size < maxBytes) chunks.push(chunk.subarray(0, maxBytes - size));
          size += chunk.length;
          if (size >= maxBytes) {
            done();
            res.destroy();
          }
        });
        res.on("end", done);
        res.on("error", done);
      },
    );
    const timer = setTimeout(() => {
      finish(() => reject(new Error(`timed out after ${Math.round(timeoutMs / 1000)}s`)));
      req.destroy();
    }, timeoutMs);
    req.on("error", (err) => finish(() => reject(err)));
    req.end(body);
  });
}
