// apps/api/src/lib/social/mediaProxy.ts
//
// Signed, expiring links to a scheduled IMAGE on our own API domain. TikTok
// only pulls photos from a domain verified in its developer portal, and a
// Supabase Storage URL can't be verified, so TikTok is given one of these.
// The signature binds the media id and expiry; nothing else is reachable.

import { createHmac, timingSafeEqual } from "node:crypto";
import { getEnv } from "../env";

const TTL_SEC = 2 * 3600;

function key(): string {
  const { ADMIN_API_SECRET } = getEnv();
  if (!ADMIN_API_SECRET) throw new Error("ADMIN_API_SECRET is needed to sign media links");
  return createHmac("sha256", ADMIN_API_SECRET).update("social-media-proxy:v1").digest("hex");
}

const sign = (id: string, exp: number) => createHmac("sha256", key()).update(`${id}.${exp}`).digest("base64url");

export function mediaProxyUrl(id: string, now = Date.now()): string {
  const base = (getEnv().API_PUBLIC_URL ?? "").replace(/\/+$/, "");
  const exp = Math.floor(now / 1000) + TTL_SEC;
  return `${base}/api/social/media/${id}?exp=${exp}&sig=${sign(id, exp)}`;
}

export function verifyMediaSig(id: string, exp: string | null, sig: string | null, now = Date.now()): boolean {
  const e = Number(exp);
  if (!sig || !Number.isInteger(e) || e < Math.floor(now / 1000)) return false;
  const want = Buffer.from(sign(id, e));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}
