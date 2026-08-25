import { requireAdmin } from "@/lib/auth";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { getFxHistory } from "@/lib/maplerad/fx";

export const dynamic = "force-dynamic";

/**
 * Admin-only: the business's FX transaction history from Maplerad.
 *
 * Read-only, and only the deployed server holds the Maplerad secret and a
 * whitelisted egress IP. The provider's response shape is undocumented, so it is
 * passed through under `history` untouched.
 */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    return jsonOk({ history: await getFxHistory() });
  } catch (err) {
    return toErrorResponse(err);
  }
}
