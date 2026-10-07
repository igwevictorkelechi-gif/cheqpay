import { prisma } from "@cheqpay/db";
import { requireUser } from "@/lib/auth";
import {
  AD_CATEGORIES, ADULT_CATEGORIES, DAYPARTS, NIGERIAN_STATES, PLACEMENTS, PLACEMENT_LABELS, PLATFORMS, SEGMENTS,
  getAdsSettings, lagosDay,
} from "@/lib/ads";
import { assertFeatureEnabled } from "@/lib/features";
import { formatNairaMinor } from "@/lib/money";
import { jsonOk, toErrorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Everything the campaign builder needs: places and their prices, the targeting vocabulary, and sensible defaults. */
export async function GET(req: Request) {
  try {
    const auth = await requireUser(req);
    await assertFeatureEnabled("ads");
    const s = await getAdsSettings();
    const me = await prisma.user.findUnique({ where: { id: auth.id }, select: { addressState: true, kycTier: true } });
    const myState = NIGERIAN_STATES.find((st) => st.toLowerCase() === (me?.addressState ?? "").trim().toLowerCase().replace(/ state$/, "")) ?? null;
    return jsonOk({
      today: lagosDay(),
      canAdvertise: (me?.kycTier ?? 0) >= 1,
      placements: PLACEMENTS.map((p) => ({
        key: p,
        label: PLACEMENT_LABELS[p],
        perDayMinor: String(s.placementPriceMinor[p]),
        perDayFormatted: formatNairaMinor(BigInt(s.placementPriceMinor[p])),
        slotsPerDay: s.slotsPerDay[p],
      })),
      categories: Object.entries(AD_CATEGORIES).map(([key, label]) => ({ key, label, adultOnly: ADULT_CATEGORIES.includes(key as never) })),
      segments: Object.entries(SEGMENTS).map(([key, label]) => ({ key, label })),
      dayparts: Object.entries(DAYPARTS).map(([key, d]) => ({ key, label: d.label })),
      platforms: PLATFORMS,
      states: NIGERIAN_STATES,
      maxDays: s.maxDays,
      minAudience: s.minAudience,
      maxFrequencyCap: s.maxFrequencyCap,
      defaults: {
        states: myState ? [myState] : [],
        radius: null,
        ageMin: 18,
        ageMax: 65,
        segments: [],
        platforms: [],
        newUsersOnly: false,
        dayparts: [],
        frequencyCap: s.defaultFrequencyCap,
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
