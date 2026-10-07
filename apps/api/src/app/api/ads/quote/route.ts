import { requireUser } from "@/lib/auth";
import { availability, estimateAudience, getAdsSettings, quoteCampaign, quoteSchema, validateCampaignShape } from "@/lib/ads";
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
    const [{ lines, totalMinor }, slots, audience, s] = await Promise.all([
      quoteCampaign(b.placements, b.days),
      availability(b.startDay, b.days),
      estimateAudience(b.targeting, b.category),
      getAdsSettings(),
    ]);
    const soldOut = b.placements.flatMap((p) => slots[p].filter((d) => d.free <= 0).map((d) => ({ placement: p, day: d.day })));
    return jsonOk({
      lines,
      totalMinor: totalMinor.toString(),
      totalFormatted: formatNairaMinor(totalMinor),
      availability: slots,
      soldOut,
      audience,
      minAudience: s.minAudience,
      audienceOk: audience >= s.minAudience,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
