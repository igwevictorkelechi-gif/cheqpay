import { requireUser } from "@/lib/auth";
import { PLACEMENTS, PLATFORMS, serveAd, type Placement, type Platform } from "@/lib/ads";
import { getFeatureFlags } from "@/lib/features";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { enforceRateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

/**
 * The ad for one place in the app, chosen for this person. `lat`/`lng` are
 * optional and only sent when they allowed location; we keep them rounded to
 * about 5 km, and not at all when "Personalised ads" is off.
 */
export async function GET(req: Request) {
  try {
    const auth = await requireUser(req);
    if (!(await getFeatureFlags()).ads) return jsonOk({ ad: null });
    await enforceRateLimit(`ad-serve:${auth.id}`, 60, 60_000);
    const q = new URL(req.url).searchParams;
    const placement = q.get("placement") as Placement;
    if (!PLACEMENTS.includes(placement)) return jsonOk({ ad: null });
    const platform = (PLATFORMS as readonly string[]).includes(q.get("platform") ?? "") ? (q.get("platform") as Platform) : null;
    const lat = Number(q.get("lat")), lng = Number(q.get("lng"));
    const location = q.has("lat") && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
    return jsonOk({ ad: await serveAd({ userId: auth.id, placement, platform, location }) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
