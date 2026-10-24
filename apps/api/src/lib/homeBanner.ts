import { prisma } from "@cheqpay/db";

/**
 * The admin's banners on the home screen, in the slot under the quick actions.
 * Several rotate as a carousel. Each lives in platform_settings as two rows,
 * so the home screen's list never drags the pictures along:
 *
 * - `home_banner:<id>`: everything but the image;
 * - `home_banner_image:<id>`: an uploaded image (data: URL), when there is one.
 *
 * `home_banners_order` holds the ids in display order. `version` changes on
 * every save and is part of the image URL, so phones fetch a new picture at
 * once and can cache each one forever.
 */
export interface HomeBanner {
  id: string;
  version: string;
  enabled: boolean;
  /** An uploaded image (served from our image route), an https link, or none. */
  image: "upload" | `https://${string}` | null;
  title: string | null;
  message: string | null;
  /** In-app path (e.g. /deposit) or https link a tap opens; null = not tappable. */
  linkUrl: string | null;
}

/** What an admin sends: imageUrl is a new upload, an https link, our own URL (keep), or null. */
export interface HomeBannerInput {
  enabled: boolean;
  imageUrl: string | null;
  title: string | null;
  message: string | null;
  linkUrl: string | null;
}

export const MAX_BANNERS = 8;

const ORDER_KEY = "home_banners_order";
const LEGACY_KEY = "home_banner";
const metaKey = (id: string) => `home_banner:${id}`;
const imageKey = (id: string) => `home_banner_image:${id}`;

const DATA_IMAGE = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/;

/** Only uploaded PNG/JPEG/WebP or an https link may be a banner image. */
export function isAllowedBannerImage(url: string): boolean {
  return url.startsWith("https://") || DATA_IMAGE.test(url);
}

/** The bytes and type of an uploaded (data: URL) image, or null for anything else. */
export function decodeDataImage(url: string | null | undefined): { contentType: string; bytes: Buffer } | null {
  const m = url ? DATA_IMAGE.exec(url) : null;
  return m ? { contentType: m[1], bytes: Buffer.from(m[2], "base64") } : null;
}

/** Where a banner's picture is fetched from. */
export function bannerImageUrl(banner: HomeBanner, origin: string): string | null {
  if (banner.image === "upload") return `${origin}/api/home-banner/image?id=${banner.id}&v=${banner.version}`;
  return banner.image;
}

/** What the apps get for one banner. */
export function publicBanner(banner: HomeBanner, origin: string) {
  return {
    id: banner.id,
    imageUrl: bannerImageUrl(banner, origin),
    title: banner.title,
    message: banner.message,
    linkUrl: banner.linkUrl,
  };
}

function parse<T>(raw: string | undefined | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function put(key: string, value: string, updatedBy?: string) {
  await prisma.platformSetting.upsert({
    where: { key },
    update: { value, updatedBy },
    create: { key, value, updatedBy },
  });
}

/**
 * Before the carousel there was one banner, kept whole (picture included)
 * under `home_banner`. Move it into the new rows the first time it's seen.
 */
async function migrateLegacy(): Promise<string[]> {
  const row = await prisma.platformSetting.findUnique({ where: { key: LEGACY_KEY } });
  const old = parse<{ id?: string; enabled?: boolean; imageUrl?: string | null; title?: string | null; message?: string | null; linkUrl?: string | null }>(row?.value);
  if (!old || typeof old.id !== "string") return [];
  const uploaded = decodeDataImage(old.imageUrl);
  const banner: HomeBanner = {
    id: old.id,
    version: crypto.randomUUID(),
    enabled: old.enabled === true,
    image: uploaded ? "upload" : old.imageUrl?.startsWith("https://") ? (old.imageUrl as `https://${string}`) : null,
    title: old.title ?? null,
    message: old.message ?? null,
    linkUrl: old.linkUrl ?? null,
  };
  if (uploaded) await put(imageKey(banner.id), old.imageUrl as string, row?.updatedBy ?? undefined);
  await put(metaKey(banner.id), JSON.stringify(banner), row?.updatedBy ?? undefined);
  await put(ORDER_KEY, JSON.stringify([banner.id]), row?.updatedBy ?? undefined);
  await prisma.platformSetting.deleteMany({ where: { key: LEGACY_KEY } });
  return [banner.id];
}

async function readOrder(): Promise<string[]> {
  const row = await prisma.platformSetting.findUnique({ where: { key: ORDER_KEY } });
  if (!row) return migrateLegacy();
  const ids = parse<unknown>(row.value);
  return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : [];
}

/** Every banner, live or not, in display order. */
export async function listHomeBanners(): Promise<HomeBanner[]> {
  const ids = await readOrder();
  if (ids.length === 0) return [];
  const rows = await prisma.platformSetting.findMany({ where: { key: { in: ids.map(metaKey) } } });
  const byKey = new Map(rows.map((r) => [r.key, parse<HomeBanner>(r.value)]));
  return ids.map((id) => byKey.get(metaKey(id))).filter((b): b is HomeBanner => Boolean(b && b.id));
}

export async function getHomeBanner(id: string): Promise<HomeBanner | null> {
  const row = await prisma.platformSetting.findUnique({ where: { key: metaKey(id) } });
  return parse<HomeBanner>(row?.value);
}

/** The uploaded picture of a banner, as stored. */
export async function getHomeBannerImage(id: string): Promise<string | null> {
  const row = await prisma.platformSetting.findUnique({ where: { key: imageKey(id) } });
  return row?.value ?? null;
}

/** Work out the stored image from what the admin sent, saving a new upload. */
async function applyImage(id: string, imageUrl: string | null, current: HomeBanner | null, updatedBy?: string): Promise<HomeBanner["image"]> {
  if (imageUrl && DATA_IMAGE.test(imageUrl)) {
    await put(imageKey(id), imageUrl, updatedBy);
    return "upload";
  }
  // Our own image URL coming back unchanged: keep the stored upload.
  if (imageUrl && current?.image === "upload") {
    try {
      const u = new URL(imageUrl);
      if (u.pathname === "/api/home-banner/image" && u.searchParams.get("id") === id) return "upload";
    } catch {
      /* not a URL; handled below */
    }
  }
  await prisma.platformSetting.deleteMany({ where: { key: imageKey(id) } });
  return imageUrl ? (imageUrl as `https://${string}`) : null;
}

export async function createHomeBanner(input: HomeBannerInput, updatedBy?: string): Promise<HomeBanner> {
  const ids = await readOrder();
  if (ids.length >= MAX_BANNERS) throw new Error(`max_banners`);
  const id = crypto.randomUUID();
  const banner: HomeBanner = {
    id,
    version: crypto.randomUUID(),
    enabled: input.enabled,
    image: await applyImage(id, input.imageUrl, null, updatedBy),
    title: input.title,
    message: input.message,
    linkUrl: input.linkUrl,
  };
  await put(metaKey(id), JSON.stringify(banner), updatedBy);
  await put(ORDER_KEY, JSON.stringify([...ids, id]), updatedBy);
  return banner;
}

export async function updateHomeBanner(id: string, input: HomeBannerInput, updatedBy?: string): Promise<HomeBanner | null> {
  const current = await getHomeBanner(id);
  if (!current) return null;
  const banner: HomeBanner = {
    ...current,
    version: crypto.randomUUID(),
    enabled: input.enabled,
    image: await applyImage(id, input.imageUrl, current, updatedBy),
    title: input.title,
    message: input.message,
    linkUrl: input.linkUrl,
  };
  await put(metaKey(id), JSON.stringify(banner), updatedBy);
  return banner;
}

export async function deleteHomeBanner(id: string, updatedBy?: string): Promise<boolean> {
  const ids = await readOrder();
  if (!ids.includes(id)) return false;
  await prisma.platformSetting.deleteMany({ where: { key: { in: [metaKey(id), imageKey(id)] } } });
  await put(ORDER_KEY, JSON.stringify(ids.filter((x) => x !== id)), updatedBy);
  return true;
}

/** Put the banners in a new order; `ids` must be exactly the current ones. */
export async function reorderHomeBanners(ids: string[], updatedBy?: string): Promise<boolean> {
  const current = await readOrder();
  const same = ids.length === current.length && new Set(ids).size === ids.length && ids.every((id) => current.includes(id));
  if (!same) return false;
  await put(ORDER_KEY, JSON.stringify(ids), updatedBy);
  return true;
}
