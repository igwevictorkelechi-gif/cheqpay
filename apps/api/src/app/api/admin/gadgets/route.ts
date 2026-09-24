import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { createProduct, listAllProducts } from "@/lib/gadgetsAdmin";
import { imageValue } from "@/lib/uploadedImage";

export const dynamic = "force-dynamic";

const specSchema = z
  .array(z.object({ label: z.string().max(80), value: z.string().max(400) }))
  .max(40);

const createSchema = z.object({
  name: z.string().min(1).max(160),
  description: z.string().max(2000).optional(),
  price: z.string().min(1), // NGN decimal string; validated in the lib
  compareAt: z.string().max(40).nullable().optional(),
  imageUrl: imageValue.optional(),
  category: z.string().max(80).optional(),
  specs: specSchema.optional(),
  stock: z.number().int().min(0).nullable().optional(),
  active: z.boolean().optional(),
});

/** Admin: the full catalog, active or not. */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    const products = await listAllProducts();
    return jsonOk({ products });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** Admin: add a product to the catalog. */
export async function POST(req: Request) {
  try {
    await requireAdmin(req);
    const body = createSchema.parse(await req.json());
    const product = await createProduct(body);
    return jsonOk({ product }, 201);
  } catch (err) {
    return toErrorResponse(err);
  }
}
