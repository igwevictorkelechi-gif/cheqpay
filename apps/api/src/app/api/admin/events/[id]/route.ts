import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { imageValue } from "@/lib/gadgetImage";
import { deactivateEvent, getEventDetail, updateEvent } from "@/lib/eventsAdmin";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(4000).optional(),
  venue: z.string().max(200).optional(),
  city: z.string().max(120).optional(),
  imageUrl: imageValue.nullable().optional(),
  startsAt: z.string().nullable().optional(),
  active: z.boolean().optional(),
});

/** Admin: one event with tiers + sales. */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    await requireAdmin(req);
    const event = await getEventDetail(params.id);
    return jsonOk({ event });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** Admin: edit an event. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    await requireAdmin(req);
    const body = patchSchema.parse(await req.json());
    const event = await updateEvent(params.id, body);
    return jsonOk({ event });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** Admin: hide an event from the storefront (soft — deactivate). */
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  try {
    await requireAdmin(req);
    const event = await deactivateEvent(params.id);
    return jsonOk({ event });
  } catch (err) {
    return toErrorResponse(err);
  }
}
