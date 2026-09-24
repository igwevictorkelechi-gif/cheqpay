import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { imageValue } from "@/lib/uploadedImage";
import { createEvent, listAllEvents } from "@/lib/eventsAdmin";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(4000).optional(),
  venue: z.string().max(200).optional(),
  city: z.string().max(120).optional(),
  imageUrl: imageValue.optional(),
  startsAt: z.string().nullable().optional(),
  active: z.boolean().optional(),
});

/** Admin: all events (active or not) with tiers + sales. */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    const events = await listAllEvents();
    return jsonOk({ events });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** Admin: create an event. */
export async function POST(req: Request) {
  try {
    await requireAdmin(req);
    const body = createSchema.parse(await req.json());
    const event = await createEvent(body);
    return jsonOk({ event }, 201);
  } catch (err) {
    return toErrorResponse(err);
  }
}
