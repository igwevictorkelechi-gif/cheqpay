import { requireUser } from "@/lib/auth";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { assertFeatureEnabled } from "@/lib/features";
import { getAjoBreakFeeBps } from "@/lib/settings";
import { fromMinorUnits } from "@/lib/money";
import { Asset } from "@cheqpay/db";
import { ajoArrearsKobo, listMyGroups, listPlans, sweepArrears } from "@/lib/ajo";
import { MIN_AMOUNT_NGN, MAX_COUNT, GROUP_MIN_TIER, PLAN_MIN_TIER } from "@/lib/ajo/rules";
import { groupView, planView } from "@/lib/ajo/view";

export const dynamic = "force-dynamic";

/**
 * Ajo home: the user's personal plans, their groups, what they owe, and the
 * rules the apps show before anyone commits. Opening it also settles any
 * arrears from money that has come in since the last scheduler pass, so a
 * user who just topped up sees the lien lift straight away.
 */
export async function GET(req: Request) {
  try {
    const auth = await requireUser(req);
    await assertFeatureEnabled("ajo");
    await sweepArrears({ deadline: Date.now() + 5_000, userId: auth.id }).catch(() => undefined);
    const [plans, groups, owed, bps] = await Promise.all([
      listPlans(auth.id),
      listMyGroups(auth.id),
      ajoArrearsKobo(auth.id),
      getAjoBreakFeeBps(),
    ]);
    return jsonOk({
      plans: plans.map(planView),
      groups: groups.map((g) => groupView(g, auth.id)),
      arrears: fromMinorUnits(owed, Asset.NGN),
      inArrears: owed > 0n,
      rules: {
        breakFeePercent: bps / 100,
        minAmountNgn: MIN_AMOUNT_NGN,
        maxCount: MAX_COUNT,
        planMinTier: PLAN_MIN_TIER,
        groupMinTier: GROUP_MIN_TIER,
        dueTime: "9:00am (Lagos)",
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
