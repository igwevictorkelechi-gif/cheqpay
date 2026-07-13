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
