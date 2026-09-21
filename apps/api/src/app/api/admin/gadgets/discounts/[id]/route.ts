import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { deleteDiscountCode, updateDiscountCode } from "@/lib/gadgetDiscounts";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  kind: z.enum(["percent", "fixed"]).optional(),
  value: z.string().min(1).optional(),
  active: z.boolean().optional(),
  startsAt: z.string().nullable().optional(),
  expiresAt: z.string().nullable().optional(),
  maxRedemptions: z.number().int().min(1).nullable().optional(),
  minSubtotal: z.string().nullable().optional(),
});

/** Admin: edit a discount code (toggle active, change value, limits, dates). */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    await requireAdmin(req);
    const body = patchSchema.parse(await req.json());
    const code = await updateDiscountCode(params.id, body);
    return jsonOk({ code });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** Admin: delete a discount code. */
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  try {
    await requireAdmin(req);
    await deleteDiscountCode(params.id);
    return jsonOk({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
