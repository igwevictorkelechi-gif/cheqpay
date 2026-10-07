import { cronRefusal } from "@/lib/cronAuth";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { runBillAutopay } from "@/lib/savedBills";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Daily, 08:05 Lagos: pay the saved bills whose autopay day is today. */
export async function GET(req: Request) {
  try {
    const refused = cronRefusal(req);
    if (refused) return refused;
    return jsonOk({ ran: true, ...(await runBillAutopay()) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
