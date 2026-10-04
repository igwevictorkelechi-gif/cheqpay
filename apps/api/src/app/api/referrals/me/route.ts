import { requireUser } from "@/lib/auth";
import { assertFeatureEnabled } from "@/lib/features";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { getMyReferral } from "@/lib/referrals";

export const dynamic = "force-dynamic";

/** The signed-in user's referral code, link, referrals and earnings. */
export async function GET(req: Request) {
  try {
    const auth = await requireUser(req);
    await assertFeatureEnabled("referrals");
    return jsonOk(await getMyReferral(auth.id));
  } catch (err) {
    return toErrorResponse(err);
  }
}
