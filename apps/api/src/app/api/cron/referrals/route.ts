import { cronRefusal } from "@/lib/cronAuth";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { settleReferrals } from "@/lib/referrals";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Daily: qualify referrals, accrue influencer commission and task rewards, void
 * what lost its source, and pay what has finished its hold. Each person's own
 * earnings are also settled whenever they open their dashboard.
 */
export async function GET(req: Request) {
  try {
    const refused = cronRefusal(req);
    if (refused) return refused;
    return jsonOk({ ran: true, ...(await settleReferrals()) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
