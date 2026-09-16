import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { deactivateProduct, updateProduct } from "@/lib/gadgetsAdmin";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  name: z.string().min(1).max(160).optional(),
  description: z.string().max(2000).optional(),
  price: z.string().min(1).optional(),
  imageUrl: z.string().url().max(2000).nullable().optional().or(z.literal("")),
  category: z.string().max(80).optional(),
  stock: z.number().int().min(0).nullable().optional(),
  active: z.boolean().optional(),
});

/** Admin: edit a product. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    await requireAdmin(req);
    const body = patchSchema.parse(await req.json());
    const product = await updateProduct(params.id, body);
    return jsonOk({ product });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** Admin: remove a product from the storefront (soft — deactivate). */
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  try {
    await requireAdmin(req);
    const product = await deactivateProduct(params.id);
    return jsonOk({ product });
  } catch (err) {
    return toErrorResponse(err);
  }
}
