import { runAdsDaily } from "@/lib/ads";
import { cronRefusal } from "@/lib/cronAuth";
import { jsonOk, toErrorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Daily: rebuild ad audiences, mark delivered days, start and end campaigns, refund unreviewed days. */
export async function GET(req: Request) {
  try {
    const refused = cronRefusal(req);
    if (refused) return refused;
    return jsonOk({ ran: true, ...(await runAdsDaily()) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
