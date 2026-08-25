import { requireUser } from "@/lib/auth";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { checkUsdAccountStatus } from "@/lib/usdAccount";

export const dynamic = "force-dynamic";

/**
 * Status of the user's USD account request (Maplerad reviews the KYC before the
 * account is APPROVED). `usdStatus` is null when the user has no USD account, or
 * when their account predates request-reference tracking and cannot be polled.
 */
export async function GET(req: Request) {
  try {
    const auth = await requireUser(req);
    return jsonOk({ usdStatus: await checkUsdAccountStatus(auth.id) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
