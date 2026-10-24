import { NextResponse } from "next/server";
import { decodeDataImage, getHomeBanner } from "@/lib/homeBanner";

export const dynamic = "force-dynamic";

/**
 * Public: the uploaded banner image. `?v=` is the banner's id, so a given URL
 * always means the same picture and can be cached for good; a new upload gets
 * a new id and so a new URL.
 */
export async function GET(req: Request) {
  const banner = await getHomeBanner().catch(() => null);
  const image = banner?.enabled ? decodeDataImage(banner.imageUrl) : null;
  if (!banner || !image) return new NextResponse(null, { status: 404 });
  const current = new URL(req.url).searchParams.get("v") === banner.id;
  return new NextResponse(new Uint8Array(image.bytes), {
    headers: {
      "content-type": image.contentType,
      "cache-control": current ? "public, max-age=31536000, immutable" : "public, max-age=60",
    },
  });
}
