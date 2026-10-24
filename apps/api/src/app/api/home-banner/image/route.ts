import { NextResponse } from "next/server";
import { decodeDataImage, getHomeBanner, getHomeBannerImage } from "@/lib/homeBanner";

export const dynamic = "force-dynamic";

/**
 * Public: one banner's uploaded picture. `id` picks the banner and `v` is its
 * version, so a given URL always means the same picture and can be cached for
 * good; saving the banner gives it a new version and so a new URL. (Links from
 * before the carousel carried only `v`, which was then the banner's id.)
 */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const id = params.get("id") ?? params.get("v");
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse(null, { status: 404 });
  const [banner, stored] = await Promise.all([
    getHomeBanner(id).catch(() => null),
    getHomeBannerImage(id).catch(() => null),
  ]);
  const image = banner?.image === "upload" ? decodeDataImage(stored) : null;
  if (!banner || !image) return new NextResponse(null, { status: 404 });
  const current = params.get("id") !== null && params.get("v") === banner.version;
  return new NextResponse(new Uint8Array(image.bytes), {
    headers: {
      "content-type": image.contentType,
      "cache-control": current ? "public, max-age=31536000, immutable" : "public, max-age=60",
    },
  });
}
