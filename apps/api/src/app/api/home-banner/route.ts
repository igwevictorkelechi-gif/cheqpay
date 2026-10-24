import { jsonOk, toErrorResponse } from "@/lib/http";
import { listHomeBanners, publicBanner } from "@/lib/homeBanner";

export const dynamic = "force-dynamic";

/**
 * Public: the live home-screen banners in display order. `banner` is the first
 * of them, for app versions from before the carousel.
 */
export async function GET(req: Request) {
  try {
    const origin = new URL(req.url).origin;
    const banners = (await listHomeBanners()).filter((b) => b.enabled).map((b) => publicBanner(b, origin));
    return jsonOk({ banners, banner: banners[0] ?? null });
  } catch (err) {
    return toErrorResponse(err);
  }
}
