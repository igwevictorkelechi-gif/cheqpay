import { jsonOk, toErrorResponse } from "@/lib/http";
import { getHomeBanner, publicBanner } from "@/lib/homeBanner";

export const dynamic = "force-dynamic";

/** Public: the home-screen banner, or null when none is live. */
export async function GET(req: Request) {
  try {
    const banner = await getHomeBanner();
    return jsonOk({
      banner: banner && banner.enabled ? publicBanner(banner, new URL(req.url).origin) : null,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
