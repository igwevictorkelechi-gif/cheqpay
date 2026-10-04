import { requireUser } from "@/lib/auth";
import { assertFeatureEnabled } from "@/lib/features";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { influencerTasks } from "@/lib/referrals";

export const dynamic = "force-dynamic";

/** Influencer portal: tasks (approved influencers only). */
export async function GET(req: Request) {
  try {
    const auth = await requireUser(req);
    await assertFeatureEnabled("referrals");
    const data = await influencerTasks(auth.id);
    return jsonOk({ tasks: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}
