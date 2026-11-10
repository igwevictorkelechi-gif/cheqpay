import { Asset } from "@cheqpay/db";
import { requireUser } from "@/lib/auth";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { assertFeatureEnabled } from "@/lib/features";
import { enforceRateLimit } from "@/lib/ratelimit";
import { readPin, requireTransactionPin } from "@/lib/transactionPin";
import { toMinorUnits } from "@/lib/money";
import { ajoGroupSchema } from "@/lib/validation";
import { createGroup } from "@/lib/ajo";
import { groupView } from "@/lib/ajo/view";

export const dynamic = "force-dynamic";

/**
 * Create an Ajo group. The organiser is its first member, so this needs the
 * transaction PIN and the lien terms, the same as joining.
 */
export async function POST(req: Request) {
  try {
    const auth = await requireUser(req);
    await assertFeatureEnabled("ajo");
    await enforceRateLimit(`ajo:group:${auth.id}`, 5, 60_000);
    const body = ajoGroupSchema.parse(await req.json());
    await requireTransactionPin(auth.id, readPin(req));
    const g = await createGroup(auth.id, {
      name: body.name,
      amountKobo: toMinorUnits(body.amount, Asset.NGN),
      frequency: body.frequency,
      size: body.size,
      order: body.payoutOrder,
    });
    return jsonOk({ group: groupView({ ...g, position: null, members: 1 }, auth.id) }, 201);
  } catch (err) {
    return toErrorResponse(err);
  }
}
