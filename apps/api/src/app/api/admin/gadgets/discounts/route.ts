import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { createDiscountCode, listDiscountCodes } from "@/lib/gadgetDiscounts";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  code: z.string().min(2).max(40),
  kind: z.enum(["percent", "fixed"]),
  value: z.string().min(1),
  active: z.boolean().optional(),
  startsAt: z.string().nullable().optional(),
  expiresAt: z.string().nullable().optional(),
  maxRedemptions: z.number().int().min(1).nullable().optional(),
  minSubtotal: z.string().nullable().optional(),
});

/** Admin: all discount codes, newest first. */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    const codes = await listDiscountCodes();
    return jsonOk({ codes });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** Admin: create a discount code. */
export async function POST(req: Request) {
  try {
    await requireAdmin(req);
    const body = createSchema.parse(await req.json());
    const code = await createDiscountCode(body);
    return jsonOk({ code }, 201);
  } catch (err) {
    return toErrorResponse(err);
  }
}
