// apps/api/src/lib/social/rules.ts
//
// What each social platform accepts, and the checks a post must pass before it
// can be approved for that platform. Pure: no I/O, so it is unit tested and the
// dashboard can show the same errors the publisher would hit.

export const PLATFORMS = ["facebook", "instagram", "x", "tiktok", "linkedin"] as const;
export type Platform = (typeof PLATFORMS)[number];

export function isPlatform(v: unknown): v is Platform {
  return typeof v === "string" && (PLATFORMS as readonly string[]).includes(v);
}

export const PLATFORM_LABEL: Record<Platform, string> = {
  facebook: "Facebook Page",
  instagram: "Instagram",
  x: "X (Twitter)",
  tiktok: "TikTok",
  linkedin: "LinkedIn Page",
};

export interface PlatformRules {
  /** Longest caption the platform takes (X: weighted characters). */
  captionMax: number;
  /** The platform refuses a text-only post. */
  needsMedia: boolean;
  /** Most images in one post. */
  maxImages: number;
}

export const RULES: Record<Platform, PlatformRules> = {
  facebook: { captionMax: 63_206, needsMedia: false, maxImages: 10 },
  instagram: { captionMax: 2_200, needsMedia: true, maxImages: 10 },
  x: { captionMax: 280, needsMedia: false, maxImages: 4 },
  tiktok: { captionMax: 2_200, needsMedia: true, maxImages: 35 },
  linkedin: { captionMax: 3_000, needsMedia: false, maxImages: 20 },
};

/** Largest file we accept per kind (Supabase's default per-object limit is 50 MB). */
export const MEDIA_LIMITS = {
  image: { maxBytes: 4 * 1024 * 1024, mimes: ["image/jpeg"] }, // under Vercel's 4.5 MB response cap (we proxy images for TikTok)
  video: { maxBytes: 50 * 1024 * 1024, mimes: ["video/mp4"] },
} as const;
export type MediaKind = keyof typeof MEDIA_LIMITS;

/**
 * X counts characters by weight: most Latin, Greek, Cyrillic and common
 * punctuation weigh 1, everything else (CJK, most emoji) weighs 2, and every
 * link counts as 23 whatever its length. This follows twitter-text's default
 * configuration closely enough to warn before X refuses the post.
 */
export function xWeightedLength(text: string): number {
  const URL = /https?:\/\/[^\s]+/g;
  let links = 0;
  const rest = text.replace(URL, () => {
    links++;
    return "";
  });
  let weight = 0;
  for (const ch of rest) {
    const cp = ch.codePointAt(0) ?? 0;
    const light =
      (cp >= 0 && cp <= 4351) ||
      (cp >= 8192 && cp <= 8205) ||
      (cp >= 8208 && cp <= 8223) ||
      (cp >= 8242 && cp <= 8247);
    weight += light ? 1 : 2;
  }
  return weight + links * 23;
}

export function captionLength(platform: Platform, caption: string): number {
  return platform === "x" ? xWeightedLength(caption) : [...caption].length;
}

export interface PostShape {
  caption: string;
  /** A caption for one platform only, replacing `caption` there. */
  overrides?: Partial<Record<Platform, string>>;
  media: { kind: MediaKind }[];
}

export function effectiveCaption(platform: Platform, post: Pick<PostShape, "caption" | "overrides">): string {
  const o = post.overrides?.[platform];
  return o !== undefined && o.trim() !== "" ? o : post.caption;
}

/** Problems that apply whatever the platform. */
export function validateShape(post: PostShape): string[] {
  const errors: string[] = [];
  const videos = post.media.filter((m) => m.kind === "video").length;
  const images = post.media.length - videos;
  if (videos > 1) errors.push("A post can have one video at most.");
  if (videos > 0 && images > 0) errors.push("Use either images or one video in a post, not both.");
  const anyCaption = post.caption.trim() !== "" || Object.values(post.overrides ?? {}).some((c) => c?.trim());
  if (!anyCaption && post.media.length === 0) errors.push("Write a caption or add an image or video.");
  return errors;
}

/** Problems posting this to one platform. Empty means it can go. */
export function validateForPlatform(platform: Platform, post: PostShape): string[] {
  const rules = RULES[platform];
  const label = PLATFORM_LABEL[platform];
  const errors: string[] = [];
  const caption = effectiveCaption(platform, post);
  const videos = post.media.filter((m) => m.kind === "video").length;
  const images = post.media.length - videos;

  if (rules.needsMedia && post.media.length === 0) {
    errors.push(`${label} needs at least one image or a video.`);
  }
  if (images > rules.maxImages) {
    errors.push(`${label} takes at most ${rules.maxImages} images in one post.`);
  }
  const len = captionLength(platform, caption);
  if (len > rules.captionMax) {
    errors.push(`The ${label} caption is ${len} characters; the limit is ${rules.captionMax}.`);
  }
  if (caption.trim() === "" && post.media.length === 0) {
    errors.push(`${label} needs a caption or media.`);
  }
  return errors;
}

/** Every problem for every chosen platform, keyed by platform, plus shared ones under "all". */
export function validatePost(post: PostShape, platforms: Platform[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const shared = validateShape(post);
  if (shared.length) out.all = shared;
  for (const p of new Set(platforms)) {
    const e = validateForPlatform(p, post);
    if (e.length) out[p] = e;
  }
  return out;
}

// ---- Post and target lifecycle -------------------------------------------------

export const POST_STATUSES = [
  "draft",
  "pending_approval",
  "scheduled",
  "publishing",
  "published",
  "partially_failed",
  "failed",
] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

export const TARGET_STATUSES = ["queued", "processing", "published", "failed", "cancelled"] as const;
export type TargetStatus = (typeof TARGET_STATUSES)[number];

/** A post's status once every target has finished, or null while any is still going. */
export function settledPostStatus(targets: TargetStatus[]): PostStatus | null {
  const live = targets.filter((t) => t !== "cancelled");
  if (live.some((t) => t === "queued" || t === "processing")) return null;
  if (live.length === 0) return "failed";
  const ok = live.filter((t) => t === "published").length;
  if (ok === live.length) return "published";
  return ok === 0 ? "failed" : "partially_failed";
}

/** Seconds to wait before retrying a failed attempt: 1, 4 then 15 minutes. */
export function retryDelaySeconds(attempt: number): number {
  return [60, 240, 900][Math.min(Math.max(attempt, 1), 3) - 1];
}

export const MAX_ATTEMPTS = 4;
