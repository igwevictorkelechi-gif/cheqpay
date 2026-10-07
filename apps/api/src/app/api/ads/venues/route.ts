import { requireUser } from "@/lib/auth";
import { listBookableVenues, listOwnedVenues } from "@/lib/adsVenues";
import { assertFeatureEnabled } from "@/lib/features";
import { jsonOk, toErrorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Venue screens an advertiser can book (optionally in one state), and venues they own (for Nearby). */
export async function GET(req: Request) {
  try {
    const auth = await requireUser(req);
    await assertFeatureEnabled("ads");
    const state = new URL(req.url).searchParams.get("state");
    const [venues, mine] = await Promise.all([listBookableVenues(state && state !== "all" ? state : null), listOwnedVenues(auth.id)]);
    return jsonOk({ venues, myVenues: mine });
  } catch (err) {
    return toErrorResponse(err);
  }
}
