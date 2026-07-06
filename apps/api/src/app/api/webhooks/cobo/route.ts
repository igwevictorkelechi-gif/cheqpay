import { handleCustodyWebhook } from "@/lib/custodyWebhook";
import { toErrorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Custody deposit/withdrawal webhook (Cobo WaaS). Shares the custody handler. */
export async function POST(req: Request) {
  try {
    return await handleCustodyWebhook(req);
  } catch (err) {
    return toErrorResponse(err);
  }
}
