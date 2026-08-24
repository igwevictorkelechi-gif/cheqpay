// apps/api/src/lib/maplerad/client.ts
//
// Thin fetch wrapper around the Maplerad API.
//  - Injects the bearer secret key and JSON headers.
//  - Normalizes Maplerad's { status, message, data } envelope.
//  - Surfaces a typed MapleradError on non-2xx / status:false responses.
//  - Retries idempotent (GET) requests on transient network / 5xx errors.
//
// SERVER ONLY. Never import this into apps/web or apps/mobile — it holds the
// secret key. Production also requires your server egress IP to be whitelisted
// in the Maplerad dashboard, otherwise calls fail with 403.

import type { MapleradEnvelope } from "./types";

const BASE_URL = process.env.MAPLERAD_BASE_URL ?? "https://api.maplerad.com/v1";
const SECRET_KEY = process.env.MAPLERAD_SECRET_KEY;

export class MapleradError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "MapleradError";
  }
}

type Query = Record<string, string | number | boolean | undefined>;

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Query;
  /** Client-supplied idempotency key echoed as the `reference` where supported. */
  idempotencyKey?: string;
  /** Max attempts for GET requests on transient failures. Default 3. */
  retries?: number;
  signal?: AbortSignal;
}

function buildUrl(path: string, query?: Query): string {
  const url = new URL(`${BASE_URL}${path.startsWith("/") ? path : `/${path}`}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Perform a Maplerad request and return the unwrapped `data` payload.
 * Throws MapleradError on transport errors or when `status` is false.
 */
export async function mapleradRequest<T>(
  path: string,
  opts: RequestOptions = {},
): Promise<T> {
  if (!SECRET_KEY) {
    throw new MapleradError("MAPLERAD_SECRET_KEY is not configured", 0);
  }

  const method = opts.method ?? "GET";
  const isRetryable = method === "GET";
  const maxAttempts = isRetryable ? Math.max(1, opts.retries ?? 3) : 1;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${SECRET_KEY}`,
    Accept: "application/json",
  };
  // Present the shared secret when routed through the egress proxy, so the
  // proxy is not open to anyone who discovers its URL.
  if (process.env.MAPLERAD_PROXY_SECRET) {
    headers["X-Proxy-Secret"] = process.env.MAPLERAD_PROXY_SECRET;
  }
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;

  const url = buildUrl(path, opts.query);
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, {
        method,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: opts.signal,
      });

      const text = await res.text();
      const parsed = text ? safeJson(text) : undefined;

      // Log every Maplerad response for diagnosis. Successful calls otherwise
      // leave no trace, which is exactly what made the tier-0 enrolments so hard
      // to explain. On by default; set MAPLERAD_LOG_RESPONSES=0 to silence it.
      logMaplerad(method, path, res.status, res.ok, opts.body, parsed);

      if (!res.ok) {
        // Retry 5xx on idempotent calls; fail fast on 4xx.
        if (isRetryable && res.status >= 500 && attempt < maxAttempts) {
          lastError = new MapleradError(`HTTP ${res.status}`, res.status, parsed);
          await sleep(250 * attempt);
          continue;
        }
        throw new MapleradError(
          messageFrom(parsed) ?? `Maplerad request failed (HTTP ${res.status})`,
          res.status,
          parsed,
        );
      }

      const envelope = parsed as MapleradEnvelope<T> | undefined;
      if (envelope && envelope.status === false) {
        throw new MapleradError(envelope.message || "Maplerad returned status:false", res.status, envelope);
      }
      return (envelope ? envelope.data : (parsed as T)) as T;
    } catch (err) {
      if (err instanceof MapleradError) throw err;
      // Network/abort error — retry idempotent calls.
      lastError = err;
      logMaplerad(method, path, 0, false, opts.body, {
        networkError: err instanceof Error ? err.message : String(err),
      });
      if (isRetryable && attempt < maxAttempts) {
        await sleep(250 * attempt);
        continue;
      }
      throw new MapleradError(
        err instanceof Error ? err.message : "Maplerad network error",
        0,
        err,
      );
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new MapleradError("Maplerad request failed", 0, lastError);
}

/**
 * Log one Maplerad exchange for diagnosis.
 *
 * Every call is logged — request context and the full response body — so a
 * tier-0 enrolment or a skipped upgrade can be explained from the logs rather
 * than guessed at. Two deliberate limits:
 *
 *  - The request body is redacted before logging: the BVN / identification
 *    number, the ID image and any secret are masked. The phone, name, dob and
 *    address are kept, because those are exactly what a "why is this tier 0"
 *    investigation needs to see. The RESPONSE is logged as-is.
 *  - It never throws: a logging failure must not affect the call. Silenced with
 *    MAPLERAD_LOG_RESPONSES=0 without a redeploy.
 */
function logMaplerad(
  method: string,
  path: string,
  status: number,
  ok: boolean,
  reqBody: unknown,
  resBody: unknown,
): void {
  if (process.env.MAPLERAD_LOG_RESPONSES === "0" || process.env.MAPLERAD_LOG_RESPONSES === "false") {
    return;
  }
  try {
    const line = `[maplerad] ${method} ${path} -> HTTP ${status || "network-error"} ok=${ok}`;
    const payload = {
      request: redactForLog(reqBody),
      response: resBody,
    };
    const detail = truncate(JSON.stringify(payload));
    if (ok) console.log(line, detail);
    else console.error(line, detail);
  } catch {
    // Never let logging break a request.
  }
}

/** Mask the fields that must not reach the logs, leaving the rest for context. */
const REDACTED_KEYS = new Set([
  "identification_number",
  "bvn",
  "image",
  "secret",
  "secret_key",
  "card_number",
  "cvv",
  "pin",
]);
function redactForLog(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactForLog);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = REDACTED_KEYS.has(k) ? "[redacted]" : redactForLog(v);
    }
    return out;
  }
  return value;
}

/** Keep a single log line from swallowing the whole log budget. */
function truncate(s: string, max = 4000): string {
  return s.length > max ? `${s.slice(0, max)}…(${s.length} chars)` : s;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function messageFrom(parsed: unknown): string | undefined {
  if (parsed && typeof parsed === "object" && "message" in parsed) {
    const m = (parsed as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return undefined;
}
