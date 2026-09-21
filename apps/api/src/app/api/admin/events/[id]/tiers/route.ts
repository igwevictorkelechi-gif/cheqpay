import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { createTier } from "@/lib/eventsAdmin";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  name: z.string().min(1).max(120),
  price: z.string().min(1),
  capacity: z.number().int().min(0).nullable().optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

/** Admin: add a ticket tier to an event. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    await requireAdmin(req);
    const body = createSchema.parse(await req.json());
    const event = await createTier(params.id, body);
    return jsonOk({ event }, 201);
  } catch (err) {
    return toErrorResponse(err);
  }
}
