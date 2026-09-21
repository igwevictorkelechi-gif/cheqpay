import { requireAdmin } from "@/lib/auth";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { listEventTickets } from "@/lib/eventsAdmin";

export const dynamic = "force-dynamic";

/** Admin: the attendee list for an event. */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    await requireAdmin(req);
    const tickets = await listEventTickets(params.id);
    return jsonOk({ tickets });
  } catch (err) {
    return toErrorResponse(err);
  }
}
