import { z } from "zod";
import { recordAdminAction, requireAdminActor, requireAdminOtp } from "@/lib/adminGuard";
import { PLACEMENTS, getAdsSettings, setAdsSettings, type AdsSettings, type Placement } from "@/lib/ads";
import { jsonOk, toErrorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

const perPlacement = <T extends z.ZodTypeAny>(v: T) => z.object(Object.fromEntries(PLACEMENTS.map((p) => [p, v])) as Record<Placement, T>);
const schema = z.object({
  price: perPlacement(z.number().min(0).max(100_000_000)),
  slots: perPlacement(z.number().int().min(0).max(50)),
  maxDays: z.number().int().min(1).max(365),
  minAudience: z.number().int().min(1).max(1_000_000),
  defaultFrequencyCap: z.number().int().min(1).max(10),
  maxFrequencyCap: z.number().int().min(1).max(10),
});

function view(s: AdsSettings) {
  return {
    price: Object.fromEntries(PLACEMENTS.map((p) => [p, s.placementPriceMinor[p] / 100])),
    slots: s.slotsPerDay,
    maxDays: s.maxDays,
    minAudience: s.minAudience,
    defaultFrequencyCap: s.defaultFrequencyCap,
    maxFrequencyCap: s.maxFrequencyCap,
  };
}

export async function GET(req: Request) {
  try {
    await requireAdminActor(req, { superOnly: true });
    return jsonOk({ settings: view(await getAdsSettings()) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** Prices in ₦ per day. Changes what every new campaign costs, so it needs a fresh code. */
export async function POST(req: Request) {
  try {
    const actor = await requireAdminActor(req, { superOnly: true });
    await requireAdminOtp(req);
    const b = schema.parse(await req.json());
    const saved = await setAdsSettings(
      {
        placementPriceMinor: Object.fromEntries(PLACEMENTS.map((p) => [p, Math.round(b.price[p] * 100)])) as Record<Placement, number>,
        slotsPerDay: b.slots,
        maxDays: b.maxDays,
        minAudience: b.minAudience,
        defaultFrequencyCap: Math.min(b.defaultFrequencyCap, b.maxFrequencyCap),
        maxFrequencyCap: b.maxFrequencyCap,
      },
      actor.email,
    );
    await recordAdminAction(req, actor, { action: "admin.ads.settings", summary: "Ad prices and settings updated", resourceType: "AdsSettings", details: b });
    return jsonOk({ settings: view(saved) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
