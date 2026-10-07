import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { recordVenueEvent } from "@/lib/adsVenues";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { enforceRateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

const schema = z.object({ venueId: z.string().uuid(), kind: z.enum(["view", "tap"]), campaignId: z.string().uuid().nullable().default(null) });

/** Someone saw or opened a venue in Nearby. Counted at most once a minute (views) / half hour (taps) per person. */
export async function POST(req: Request) {
  try {
    const auth = await requireUser(req);
    const b = schema.parse(await req.json());
    try {
      await enforceRateLimit(`venue-ev:${b.kind}:${auth.id}:${b.venueId}`, 1, b.kind === "view" ? 60_000 : 30 * 60_000);
    } catch {
      return jsonOk({ counted: false });
    }
    await recordVenueEvent(b.venueId, b.kind, b.campaignId, auth.id);
    return jsonOk({ counted: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
