import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { assertFeatureEnabled } from "@/lib/features";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { enforceRateLimit } from "@/lib/ratelimit";
import { deleteSavedBill, savedBillAutopayOn, updateSavedBill } from "@/lib/savedBills";
import { readPin, requireTransactionPin } from "@/lib/transactionPin";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  nickname: z.string().min(1).max(60).optional(),
  planId: z.string().max(80).nullable().optional(),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/).nullable().optional(),
  autopay: z.boolean().optional(),
  autopayDay: z.number().int().min(1).max(28).nullable().optional(),
});

/**
 * Rename, change the amount/plan, or switch autopay. Autopay is a standing
 * instruction to spend, so turning it on — or changing what it pays while
 * it's on — needs the transaction PIN. Turning it off never does.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireUser(req);
    await assertFeatureEnabled("bill_payments");
    await enforceRateLimit(`bills-saved:${auth.id}`, 30, 60_000);
    const { id } = await ctx.params;
    const b = patchSchema.parse(await req.json());
    const wasOn = await savedBillAutopayOn(auth.id, id);
    const spendChange = b.autopay === true || (wasOn && b.autopay !== false && (b.amount !== undefined || b.planId !== undefined || b.autopayDay !== undefined));
    if (spendChange) await requireTransactionPin(auth.id, readPin(req));
    await updateSavedBill(auth.id, id, b);
    return jsonOk({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireUser(req);
    const { id } = await ctx.params;
    await deleteSavedBill(auth.id, id);
    return jsonOk({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
