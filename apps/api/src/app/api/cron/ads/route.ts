import { runAdsDaily } from "@/lib/ads";
import { settleVenueDays } from "@/lib/adsVenues";
import { cronRefusal } from "@/lib/cronAuth";
import { jsonOk, toErrorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Daily: settle venue screen-days (pay venues / refund offline days), rebuild audiences, mark delivered days, start and end campaigns. */
export async function GET(req: Request) {
  try {
    const refused = cronRefusal(req);
    if (refused) return refused;
    const venues = await settleVenueDays();
    return jsonOk({ ran: true, ...(await runAdsDaily()), venues });
  } catch (err) {
    return toErrorResponse(err);
  }
}
