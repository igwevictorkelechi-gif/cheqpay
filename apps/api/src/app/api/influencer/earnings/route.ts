import { requireUser } from "@/lib/auth";
import { assertFeatureEnabled } from "@/lib/features";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { influencerEarnings } from "@/lib/referrals";

export const dynamic = "force-dynamic";

/** Influencer portal: earnings (approved influencers only). */
export async function GET(req: Request) {
  try {
    const auth = await requireUser(req);
    await assertFeatureEnabled("referrals");
    const data = await influencerEarnings(auth.id);
    return jsonOk({ earnings: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}
