import { prisma } from "@cheqpay/db";

/**
 * The admin-uploaded banner on the home screen, in the slot under the quick
 * actions. Stored as one JSON blob in platform_settings, like the popup.
 * `id` changes on every save, which versions the image URL so phones fetch a
 * new banner at once and can cache each one forever.
 */
export interface HomeBanner {
  id: string;
  enabled: boolean;
  /** https URL, or a data: URL uploaded from the admin dashboard. */
  imageUrl: string | null;
  title: string | null;
  message: string | null;
  /** In-app path (e.g. /deposit) or https link a tap opens; null = not tappable. */
  linkUrl: string | null;
}

const KEY = "home_banner";

export async function getHomeBanner(): Promise<HomeBanner | null> {
  const row = await prisma.platformSetting.findUnique({ where: { key: KEY } });
  if (!row) return null;
  try {
    const b = JSON.parse(row.value) as HomeBanner;
    return b && typeof b === "object" && typeof b.id === "string" ? b : null;
  } catch {
    return null;
  }
}

export async function setHomeBanner(input: Omit<HomeBanner, "id">, updatedBy?: string): Promise<HomeBanner> {
  const banner: HomeBanner = { ...input, id: crypto.randomUUID() };
  await prisma.platformSetting.upsert({
    where: { key: KEY },
    update: { value: JSON.stringify(banner), updatedBy },
    create: { key: KEY, value: JSON.stringify(banner), updatedBy },
  });
  return banner;
}

const DATA_IMAGE = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/;

/** Only uploaded PNG/JPEG/WebP or an https link may be a banner image. */
export function isAllowedBannerImage(url: string): boolean {
  return url.startsWith("https://") || DATA_IMAGE.test(url);
}

/** The bytes and type of an uploaded (data: URL) image, or null for anything else. */
export function decodeDataImage(url: string | null): { contentType: string; bytes: Buffer } | null {
  const m = url ? DATA_IMAGE.exec(url) : null;
  return m ? { contentType: m[1], bytes: Buffer.from(m[2], "base64") } : null;
}

/**
 * What the apps get: an uploaded image is served from its own versioned URL,
 * so the home screen's request stays a few hundred bytes instead of carrying
 * the whole picture every time.
 */
export function publicBanner(banner: HomeBanner, origin: string): Omit<HomeBanner, "enabled"> {
  const { enabled: _enabled, ...rest } = banner;
  const imageUrl = decodeDataImage(banner.imageUrl)
    ? `${origin}/api/home-banner/image?v=${banner.id}`
    : banner.imageUrl;
  return { ...rest, imageUrl };
}
