import { requireUser } from "@/lib/auth";
import { VENUE_CATEGORIES, nearbyVenues } from "@/lib/adsVenues";
import { getFeatureFlags } from "@/lib/features";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { enforceRateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

/**
 * Partner places near the person: nearest first from their rough location
 * (only if they allowed it), otherwise in their state.
 */
export async function GET(req: Request) {
  try {
    const auth = await requireUser(req);
    if (!(await getFeatureFlags()).ads) return jsonOk({ venues: [], basis: "all", categories: [] });
    await enforceRateLimit(`nearby:${auth.id}`, 30, 60_000);
    const q = new URL(req.url).searchParams;
    const lat = Number(q.get("lat")), lng = Number(q.get("lng"));
    const location = q.has("lat") && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
    const cat = q.get("category");
    const category = cat && cat in VENUE_CATEGORIES ? cat : null;
    const r = await nearbyVenues({ userId: auth.id, location, category });
    return jsonOk({ ...r, categories: Object.entries(VENUE_CATEGORIES).map(([key, label]) => ({ key, label })) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
