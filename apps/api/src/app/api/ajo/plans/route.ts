import { Asset } from "@cheqpay/db";
import { requireUser } from "@/lib/auth";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { assertFeatureEnabled } from "@/lib/features";
import { enforceRateLimit } from "@/lib/ratelimit";
import { readPin, requireTransactionPin } from "@/lib/transactionPin";
import { toMinorUnits } from "@/lib/money";
import { ajoPlanSchema } from "@/lib/validation";
import { createPlan } from "@/lib/ajo";
import { planView } from "@/lib/ajo/view";

export const dynamic = "force-dynamic";

/**
 * Start a personal Ajo plan. Needs the transaction PIN: it takes the first
 * contribution now and authorises the rest to be taken on their due dates.
 */
export async function POST(req: Request) {
  try {
    const auth = await requireUser(req);
    await assertFeatureEnabled("ajo");
    await enforceRateLimit(`ajo:plan:${auth.id}`, 5, 60_000);
    const body = ajoPlanSchema.parse(await req.json());
    await requireTransactionPin(auth.id, readPin(req));
    const plan = await createPlan(auth.id, {
      name: body.name,
      amountKobo: toMinorUnits(body.amount, Asset.NGN),
      frequency: body.frequency,
      count: body.count,
    });
    return jsonOk({ plan: planView(plan) }, 201);
  } catch (err) {
    return toErrorResponse(err);
  }
}
