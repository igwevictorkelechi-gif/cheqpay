import { requireUser } from "@/lib/auth";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { getUsdAccountWire } from "@/lib/usdAccount";

export const dynamic = "force-dynamic";

/**
 * Full wire instructions (ACH/FEDWIRE/SWIFT) for the user's USD account, for
 * receiving international transfers. `wire` is null when the user has no USD
 * account.
 */
export async function GET(req: Request) {
  try {
    const auth = await requireUser(req);
    return jsonOk({ wire: await getUsdAccountWire(auth.id) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
