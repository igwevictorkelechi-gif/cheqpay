import { z } from "zod";
import { Asset } from "@cheqpay/db";
import { requireUser } from "@/lib/auth";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { assertFeatureEnabled } from "@/lib/features";
import { enforceRateLimit } from "@/lib/ratelimit";
import { readPin, requireTransactionPin } from "@/lib/transactionPin";
import { formatNairaMinor, fromMinorUnits } from "@/lib/money";
import { breakPlan } from "@/lib/ajo";
import { notifyUser } from "@/lib/alerts";

export const dynamic = "force-dynamic";

/**
 * Break a personal plan early: what was saved returns to the wallet minus the
 * break fee. Needs the transaction PIN. Plans that run to the end are free.
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireUser(req);
    await assertFeatureEnabled("ajo");
    await enforceRateLimit(`ajo:break:${auth.id}`, 5, 60_000);
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) throw new ApiError(404, "Plan not found", "not_found");
    await requireTransactionPin(auth.id, readPin(req));
    const r = await breakPlan(auth.id, id);
    const returned = fromMinorUnits(r.returnedKobo, Asset.NGN);
    const fee = fromMinorUnits(r.feeKobo, Asset.NGN);
    await notifyUser(auth.id, {
      category: "savings",
      title: "Ajo plan ended early",
      body: r.feeKobo > 0n
        ? `${formatNairaMinor(r.returnedKobo)} is back in your wallet (${formatNairaMinor(r.feeKobo)} break fee).`
        : `${formatNairaMinor(r.returnedKobo)} is back in your wallet.`,
      data: { ajoPlanId: id },
    }).catch(() => undefined);
    return jsonOk({ returned, fee });
  } catch (err) {
    return toErrorResponse(err);
  }
}
