// apps/api/src/lib/social/providers/http.ts
//
// One fetch wrapper for every platform call: a timeout, the JSON (or text) body
// whatever the status, and network failures turned into retryable errors.

import { SocialError } from "./types";

export interface HttpResult<T = unknown> {
  status: number;
  ok: boolean;
  headers: Headers;
  json: T;
  text: string;
}

export async function http<T = Record<string, unknown>>(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<HttpResult<T>> {
  const { timeoutMs = 30_000, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(url, { ...rest, signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new SocialError(`Couldn't reach ${new URL(url).host}: ${msg}`, true);
  }
  const text = await res.text();
  let json: unknown = {};
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = {};
    }
  }
  return { status: res.status, ok: res.ok, headers: res.headers, json: json as T, text };
}

/** application/x-www-form-urlencoded body from a flat record (undefined values skipped). */
export function form(fields: Record<string, string | number | boolean | undefined | null>): URLSearchParams {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== null) p.set(k, String(v));
  return p;
}

export function qs(fields: Record<string, string | number | undefined>): string {
  return form(fields).toString();
}

/** Seconds from now as a Date, or null. */
export const expiresIn = (seconds: unknown): Date | null =>
  typeof seconds === "number" && seconds > 0 ? new Date(Date.now() + seconds * 1000) : null;

/** Trim a platform's error text so it fits in a dashboard row. */
export const clip = (s: string, n = 300) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
