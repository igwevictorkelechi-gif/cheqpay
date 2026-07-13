// apps/api/src/lib/maplerad/webhooks.ts
//
// Maplerad signs webhooks with Svix (HMAC-SHA256). Verify BEFORE parsing the
// body, and verify against the RAW request body — any re-serialization breaks
// the signature.
//
// Signing scheme (from the Maplerad docs):
//   signedContent = `${svix-id}.${svix-timestamp}.${rawBody}`
//   key           = base64-decode(secret after the `whsec_` prefix)
//   expected      = base64( HMAC_SHA256(key, signedContent) )
//   svix-signature header is a space-delimited list of `v1,<sig>` entries;
//   the message is valid if `expected` matches any of them.

import crypto from "node:crypto";
import type { MapleradWebhookEvent } from "./types";

const WEBHOOK_SECRET = process.env.MAPLERAD_WEBHOOK_SECRET ?? "";

// Maplerad's published webhook source IPs (defense in depth alongside the sig).
export const MAPLERAD_WEBHOOK_IPS = [
  "54.216.8.72",
  "54.173.54.49",
  "52.215.16.239",
  "52.55.123.25",
  "52.6.93.106",
  "63.33.109.123",
  "44.228.126.217",
  "50.112.21.217",
  "52.24.126.164",
  "54.148.139.208",
] as const;

export interface SvixHeaders {
  id: string;
  timestamp: string;
  signature: string;
}

/** Extract the three Svix headers from a Headers object (case-insensitive). */
export function readSvixHeaders(headers: Headers): SvixHeaders | null {
  const id = headers.get("svix-id");
  const timestamp = headers.get("svix-timestamp");
  const signature = headers.get("svix-signature");
  if (!id || !timestamp || !signature) return null;
  return { id, timestamp, signature };
}

/**
 * Verify a Maplerad webhook signature against the raw body.
 * @param rawBody   the exact bytes/string received (do not JSON.parse first)
 * @param toleranceSeconds  reject messages whose timestamp is older/newer than this (default 5 min)
 */
export function verifyWebhook(
  rawBody: string,
  svix: SvixHeaders,
  toleranceSeconds = 300,
): boolean {
  if (!WEBHOOK_SECRET.includes("_")) return false;

  // Timestamp tolerance check (prevents replay).
  const ts = Number(svix.timestamp);
  if (!Number.isFinite(ts)) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > toleranceSeconds) return false;

  const secretBytes = Buffer.from(WEBHOOK_SECRET.split("_")[1], "base64");
  const signedContent = `${svix.id}.${svix.timestamp}.${rawBody}`;
  const expected = crypto
    .createHmac("sha256", secretBytes)
    .update(signedContent)
    .digest("base64");

  // Header is space-delimited `v<n>,<sig>` entries. Match any.
  for (const entry of svix.signature.split(" ")) {
    const comma = entry.indexOf(",");
    const sig = comma === -1 ? entry : entry.slice(comma + 1);
    if (timingSafeEqual(sig, expected)) return true;
  }
  return false;
}

function timingSafeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// ---- Event routing --------------------------------------------------------

export type WebhookHandler = (event: MapleradWebhookEvent) => Promise<void> | void;

/**
 * Minimal event router. Register handlers by event name; unknown events are
 * ignored (return 200 so Maplerad doesn't retry forever). Extend the switch as
 * later phases add deposit / card / transfer events.
 */
export async function routeWebhookEvent(
  event: MapleradWebhookEvent,
  handlers: Partial<Record<string, WebhookHandler>>,
): Promise<void> {
  const key = event.event ?? event.type ?? "";
  const handler = handlers[key];
  if (handler) await handler(event);
}
