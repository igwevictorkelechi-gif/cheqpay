import { assertFeatureEnabled } from "@/lib/features";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { PLAN_IDS, getPlans } from "@/lib/devapi/plans";
import { planView } from "@/lib/devapi/serialize";

export const dynamic = "force-dynamic";

/** The plans and their prices, for the pricing page. Public: prices aren't secret. */
export async function GET() {
  try {
    await assertFeatureEnabled("developer_api");
    const plans = await getPlans();
    return jsonOk({ plans: PLAN_IDS.map((id) => planView(plans[id])) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
