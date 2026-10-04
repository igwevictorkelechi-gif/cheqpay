import { requireUser } from "@/lib/auth";
import { assertFeatureEnabled } from "@/lib/features";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { influencerDashboard } from "@/lib/referrals";

export const dynamic = "force-dynamic";

/** Influencer portal: dashboard (approved influencers only). */
export async function GET(req: Request) {
  try {
    const auth = await requireUser(req);
    await assertFeatureEnabled("referrals");
    const data = await influencerDashboard(auth.id);
    return jsonOk(data);
  } catch (err) {
    return toErrorResponse(err);
  }
}
