import { requireUser } from "@/lib/auth";
import { availability, estimateAudience, getAdsSettings, planCampaign, quoteSchema, validateCampaignShape } from "@/lib/ads";
import { assertFeatureEnabled } from "@/lib/features";
import { formatNairaMinor } from "@/lib/money";
import { enforceRateLimit } from "@/lib/ratelimit";
import { jsonOk, toErrorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Price, free slots per day and how many people the targeting reaches — before paying. */
export async function POST(req: Request) {
  try {
    const auth = await requireUser(req);
    await assertFeatureEnabled("ads");
    await enforceRateLimit(`ad-quote:${auth.id}`, 60, 60_000);
    const b = quoteSchema.parse(await req.json());
    await validateCampaignShape(b);
    const [{ lines, breakdown, totalMinor }, s] = await Promise.all([
      planCampaign({ placements: b.placements, venues: b.venues, nearbyVenueId: b.nearbyVenueId, influencer: b.influencer, days: b.days, userId: auth.id }),
      getAdsSettings(),
    ]);
    const [slots, audience] = await Promise.all([
      availability(b.startDay, b.days, lines),
      b.placements.length ? estimateAudience(b.targeting, b.category) : Promise.resolve(null),
    ]);
    const soldOut = lines.flatMap((l) => slots[l.channel].filter((d) => d.free <= 0).map((d) => ({ channel: l.channel, label: l.label, day: d.day })));
    return jsonOk({
      lines: breakdown,
      totalMinor: totalMinor.toString(),
      totalFormatted: formatNairaMinor(totalMinor),
      availability: slots,
      soldOut,
      audience,
      minAudience: s.minAudience,
      audienceOk: audience === null || audience >= s.minAudience,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
