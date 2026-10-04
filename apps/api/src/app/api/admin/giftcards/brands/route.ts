import { z } from "zod";
import { recordAdminAction, requireAdminActor } from "@/lib/adminGuard";
import { upsertBrand } from "@/lib/giftCards";
import { jsonOk, toErrorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

const brandSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(60),
  logoUrl: z.string().url().max(500).nullable().optional(),
  active: z.boolean().optional(),
  sort: z.number().int().min(0).max(10_000).optional(),
});

/** Admin: add a gift card brand, or rename / switch one off. */
export async function POST(req: Request) {
  try {
    const actor = await requireAdminActor(req, { superOnly: true });
    const body = brandSchema.parse(await req.json());
    const id = await upsertBrand(body);
    await recordAdminAction(req, actor, {
      action: body.id ? "admin.giftcard.brand_updated" : "admin.giftcard.brand_added",
      summary: `Gift card brand "${body.name}"${body.active === false ? " (off)" : ""}`,
      resourceType: "GiftCardBrand",
      resourceId: id,
      details: body,
    });
    return jsonOk({ id });
  } catch (err) {
    return toErrorResponse(err);
  }
}
