import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { deactivateProduct, getProductById, updateProduct } from "@/lib/gadgetsAdmin";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  name: z.string().min(1).max(160).optional(),
  description: z.string().max(2000).optional(),
  price: z.string().min(1).optional(),
  imageUrl: z.string().url().max(2000).nullable().optional().or(z.literal("")),
  category: z.string().max(80).optional(),
  specs: z
    .array(z.object({ label: z.string().max(80), value: z.string().max(400) }))
    .max(40)
    .optional(),
  stock: z.number().int().min(0).nullable().optional(),
  active: z.boolean().optional(),
});

/** Admin: one product for the editor. */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    await requireAdmin(req);
    const product = await getProductById(params.id);
    return jsonOk({ product });
  } catch (err) {
    return toErrorResponse(err);
  }
}

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
