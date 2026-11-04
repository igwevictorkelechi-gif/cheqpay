// apps/api/src/lib/social/storage.ts
//
// Scheduled media lives in a PRIVATE Supabase Storage bucket. The dashboard
// uploads straight to it with a one-time signed upload URL, so a 50 MB video
// never passes through a Vercel function (whose request bodies stop at 4.5 MB).
// Platforms that fetch media themselves (Facebook, Instagram) get a short-lived
// signed download URL; the others are sent the bytes by the publisher.

import { getEnv } from "../env";
import { ApiError } from "../http";
import { supabaseAdminConfig } from "../supabaseAdmin";
import { MEDIA_LIMITS } from "./rules";

function cfg(): { url: string; key: string; bucket: string } {
  const c = supabaseAdminConfig();
  if (!c) throw new ApiError(503, "Media storage isn't configured (Supabase service key missing).", "storage_unconfigured");
  return { ...c, bucket: getEnv().SOCIAL_MEDIA_BUCKET };
}

const authHeaders = (key: string) => ({ authorization: `Bearer ${key}`, apikey: key });

let bucketReady: Promise<void> | null = null;

/** Create the private bucket once; an existing bucket is fine. */
export function ensureBucket(): Promise<void> {
  if (!bucketReady) {
    bucketReady = (async () => {
      const { url, key, bucket } = cfg();
      const res = await fetch(`${url}/storage/v1/bucket`, {
        method: "POST",
        headers: { ...authHeaders(key), "content-type": "application/json" },
        body: JSON.stringify({
          id: bucket,
          name: bucket,
          public: false,
          file_size_limit: MEDIA_LIMITS.video.maxBytes,
          allowed_mime_types: [...MEDIA_LIMITS.image.mimes, ...MEDIA_LIMITS.video.mimes],
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        // 400/409 with "already exists" means it is there.
        if (!/already exists|Duplicate/i.test(text)) {
          throw new ApiError(502, `Couldn't prepare media storage: ${text.slice(0, 200)}`, "storage_bucket");
        }
      }
    })().catch((err) => {
      bucketReady = null;
      throw err;
    });
  }
  return bucketReady;
}

/** A URL the browser can PUT the file to, once, within two hours. */
export async function signedUploadUrl(path: string): Promise<string> {
  await ensureBucket();
  const { url, key, bucket } = cfg();
  const res = await fetch(`${url}/storage/v1/object/upload/sign/${bucket}/${path}`, {
    method: "POST",
    headers: { ...authHeaders(key), "content-type": "application/json" },
    body: "{}",
  });
  const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string; message?: string };
  if (!res.ok || !data.url) {
    throw new ApiError(502, `Couldn't start the upload: ${data.message ?? data.error ?? res.status}`, "storage_sign");
  }
  return `${url}/storage/v1${data.url}`;
}

/** A URL anyone holding it can download from until it expires. */
export async function signedDownloadUrl(path: string, expiresInSec = 3600): Promise<string> {
  const { url, key, bucket } = cfg();
  const res = await fetch(`${url}/storage/v1/object/sign/${bucket}/${path}`, {
    method: "POST",
    headers: { ...authHeaders(key), "content-type": "application/json" },
    body: JSON.stringify({ expiresIn: expiresInSec }),
  });
  const data = (await res.json().catch(() => ({}))) as { signedURL?: string; message?: string };
  if (!res.ok || !data.signedURL) {
    throw new ApiError(502, `Couldn't read the media file: ${data.message ?? res.status}`, "storage_sign");
  }
  return `${url}/storage/v1${data.signedURL}`;
}

/** Size and type of a stored object, or null when nothing was uploaded there. */
export async function objectInfo(path: string): Promise<{ size: number; mime: string } | null> {
  const { url, key, bucket } = cfg();
  const res = await fetch(`${url}/storage/v1/object/${bucket}/${path}`, { method: "HEAD", headers: authHeaders(key) });
  if (!res.ok) return null;
  return { size: Number(res.headers.get("content-length") ?? 0), mime: res.headers.get("content-type") ?? "" };
}

/** The file's bytes, for platforms that take an upload rather than a link. */
export async function downloadObject(path: string): Promise<Buffer> {
  const { url, key, bucket } = cfg();
  const res = await fetch(`${url}/storage/v1/object/${bucket}/${path}`, { headers: authHeaders(key) });
  if (!res.ok) throw new ApiError(502, `Couldn't read the media file (${res.status}).`, "storage_read");
  return Buffer.from(await res.arrayBuffer());
}

export async function removeObjects(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const { url, key, bucket } = cfg();
  await fetch(`${url}/storage/v1/object/${bucket}`, {
    method: "DELETE",
    headers: { ...authHeaders(key), "content-type": "application/json" },
    body: JSON.stringify({ prefixes: paths }),
  }).catch(() => undefined);
}
