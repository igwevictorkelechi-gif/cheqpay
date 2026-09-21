import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { removeTier, updateTier } from "@/lib/eventsAdmin";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  price: z.string().min(1).optional(),
  capacity: z.number().int().min(0).nullable().optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

/** Admin: edit a tier. */
export async function PATCH(req: Request, { params }: { params: { tierId: string } }) {
  try {
    await requireAdmin(req);
    const body = patchSchema.parse(await req.json());
    const event = await updateTier(params.tierId, body);
    return jsonOk({ event });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** Admin: remove a tier (soft-deactivates if any sold). */
export async function DELETE(req: Request, { params }: { params: { tierId: string } }) {
  try {
    await requireAdmin(req);
    const event = await removeTier(params.tierId);
    return jsonOk({ event });
  } catch (err) {
    return toErrorResponse(err);
  }
}
