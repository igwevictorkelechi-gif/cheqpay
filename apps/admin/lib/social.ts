// Shared client code for the Social section. The platform rules mirror
// apps/api/src/lib/social/rules.ts so the composer can warn as people type;
// the backend checks again and is the one that decides.

export const PLATFORMS = ['facebook', 'instagram', 'x', 'tiktok', 'linkedin'] as const;
export type Platform = (typeof PLATFORMS)[number];

export const PLATFORM_LABEL: Record<Platform, string> = {
  facebook: 'Facebook Page',
  instagram: 'Instagram',
  x: 'X (Twitter)',
  tiktok: 'TikTok',
  linkedin: 'LinkedIn Page',
};

export const PLATFORM_COLOR: Record<Platform, string> = {
  facebook: '#1877F2',
  instagram: '#E1306C',
  x: '#111111',
  tiktok: '#00A6A6',
  linkedin: '#0A66C2',
};

const RULES: Record<Platform, { captionMax: number; needsMedia: boolean; maxImages: number }> = {
  facebook: { captionMax: 63_206, needsMedia: false, maxImages: 10 },
  instagram: { captionMax: 2_200, needsMedia: true, maxImages: 10 },
  x: { captionMax: 280, needsMedia: false, maxImages: 4 },
  tiktok: { captionMax: 2_200, needsMedia: true, maxImages: 35 },
  linkedin: { captionMax: 3_000, needsMedia: false, maxImages: 20 },
};

export const captionMax = (p: Platform) => RULES[p].captionMax;

export function xWeightedLength(text: string): number {
  let links = 0;
  const rest = text.replace(/https?:\/\/[^\s]+/g, () => {
    links++;
    return '';
  });
  let w = 0;
  for (const ch of rest) {
    const cp = ch.codePointAt(0) ?? 0;
    const light = cp <= 4351 || (cp >= 8192 && cp <= 8205) || (cp >= 8208 && cp <= 8223) || (cp >= 8242 && cp <= 8247);
    w += light ? 1 : 2;
  }
  return w + links * 23;
}

export const captionLength = (p: Platform, text: string) => (p === 'x' ? xWeightedLength(text) : [...text].length);

export type MediaKind = 'image' | 'video';

export function problemsFor(p: Platform, caption: string, media: { kind: MediaKind }[]): string[] {
  const r = RULES[p];
  const out: string[] = [];
  const videos = media.filter((m) => m.kind === 'video').length;
  const images = media.length - videos;
  if (r.needsMedia && media.length === 0) out.push(`${PLATFORM_LABEL[p]} needs an image or a video.`);
  if (images > r.maxImages) out.push(`${PLATFORM_LABEL[p]} takes at most ${r.maxImages} images.`);
  const len = captionLength(p, caption);
  if (len > r.captionMax) out.push(`Caption is ${len}/${r.captionMax} characters on ${PLATFORM_LABEL[p]}.`);
  return out;
}

// ---- Types from the API ---------------------------------------------------------

export type PostStatus = 'draft' | 'pending_approval' | 'scheduled' | 'publishing' | 'published' | 'partially_failed' | 'failed';
export type TargetStatus = 'queued' | 'processing' | 'published' | 'failed' | 'cancelled';

export interface Account {
  id: string;
  platform: Platform;
  name: string;
  username: string | null;
  avatarUrl: string | null;
  status: 'active' | 'needs_reconnect' | 'disconnected';
  lastError: string | null;
  tokenExpiresAt: string | null;
  connectedBy: string;
  createdAt: string;
}

export interface Media {
  id: string;
  kind: MediaKind;
  mime: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  status: 'pending' | 'ready';
}

export interface Target {
  id: string;
  accountId: string;
  platform: Platform;
  accountName: string;
  status: TargetStatus;
  attempts: number;
  externalUrl: string | null;
  error: string | null;
  publishedAt: string | null;
}

export interface Post {
  id: string;
  caption: string;
  overrides: Partial<Record<Platform, string>>;
  media: Media[];
  status: PostStatus;
  scheduledAt: string | null;
  reviewNote: string | null;
  createdBy: string;
  submittedAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  targets: Target[];
}

export interface ProviderInfo {
  id: 'meta' | 'x' | 'tiktok' | 'linkedin';
  label: string;
  platforms: Platform[];
  configured: boolean;
  callbackUrl: string | null;
}

export const STATUS_LABEL: Record<PostStatus, string> = {
  draft: 'Draft',
  pending_approval: 'Needs approval',
  scheduled: 'Scheduled',
  publishing: 'Publishing',
  published: 'Published',
  partially_failed: 'Partly failed',
  failed: 'Failed',
};

export const STATUS_STYLE: Record<PostStatus, string> = {
  draft: 'bg-gray-100 text-gray-700',
  pending_approval: 'bg-amber-100 text-amber-800',
  scheduled: 'bg-blue-100 text-blue-800',
  publishing: 'bg-indigo-100 text-indigo-800',
  published: 'bg-green-100 text-green-800',
  partially_failed: 'bg-orange-100 text-orange-800',
  failed: 'bg-red-100 text-red-700',
};

// ---- Calls -------------------------------------------------------------------------

/** JSON call to the dashboard proxy; throws the API's message on failure. */
export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api/social/${path}`, {
    method: init.method ?? 'GET',
    headers: init.body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const issue = Array.isArray(data.issues) && data.issues[0]?.message ? String(data.issues[0].message) : null;
    throw new Error(issue ?? data.error ?? `Request failed (${res.status})`);
  }
  return data as T;
}

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

/**
 * Every image becomes a JPEG at most 2048px on its long side: Instagram only
 * takes JPEG, and our image limit is 4 MB. Quality steps down until it fits.
 */
async function toJpeg(file: File): Promise<{ blob: Blob; width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot prepare images.');
  ctx.fillStyle = '#ffffff'; // transparent PNG areas become white, not black
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  for (const q of [0.92, 0.85, 0.75, 0.65]) {
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', q));
    if (blob && blob.size <= MAX_IMAGE_BYTES) return { blob, width, height };
  }
  throw new Error(`${file.name} is still over 4 MB after compressing.`);
}

function videoSize(file: File): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.onloadedmetadata = () => {
      resolve({ width: v.videoWidth, height: v.videoHeight });
      URL.revokeObjectURL(v.src);
    };
    v.onerror = () => resolve(null);
    v.src = URL.createObjectURL(file);
  });
}

/** Upload one file straight to private storage; returns the ready media and a local preview URL. */
export async function uploadMedia(file: File): Promise<{ media: Media; previewUrl: string }> {
  const isVideo = file.type.startsWith('video/');
  let blob: Blob = file;
  let dims: { width: number; height: number } | null = null;
  if (isVideo) {
    if (file.type !== 'video/mp4') throw new Error(`${file.name}: videos must be MP4.`);
    if (file.size > MAX_VIDEO_BYTES) throw new Error(`${file.name} is over 50 MB.`);
    dims = await videoSize(file);
  } else if (file.type.startsWith('image/')) {
    const j = await toJpeg(file);
    blob = j.blob;
    dims = { width: j.width, height: j.height };
  } else {
    throw new Error(`${file.name}: only images and MP4 videos can be posted.`);
  }
  const mime = isVideo ? 'video/mp4' : 'image/jpeg';
  const { media, uploadUrl } = await api<{ media: Media; uploadUrl: string }>('media', {
    method: 'POST',
    body: { kind: isVideo ? 'video' : 'image', mime, sizeBytes: blob.size, width: dims?.width ?? null, height: dims?.height ?? null },
  });
  const put = await fetch(uploadUrl, { method: 'PUT', headers: { 'content-type': mime, 'x-upsert': 'false' }, body: blob });
  if (!put.ok) throw new Error(`Upload of ${file.name} failed (${put.status}).`);
  const done = await api<{ media: Media }>(`media/${media.id}`, { method: 'POST' });
  return { media: done.media, previewUrl: URL.createObjectURL(blob) };
}

/** "Mon 3 Nov, 14:30" in the viewer's time zone. */
export function fmtWhen(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** An ISO time → the value a datetime-local input shows (viewer's time zone). */
export function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
