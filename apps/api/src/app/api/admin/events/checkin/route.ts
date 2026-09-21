import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { checkInTicket } from "@/lib/eventsAdmin";

export const dynamic = "force-dynamic";

const schema = z.object({ reference: z.string().min(1).max(64) });

/** Admin: check a ticket in at the gate by its reference (from the QR). */
export async function POST(req: Request) {
  try {
    await requireAdmin(req);
    const body = schema.parse(await req.json());
    const result = await checkInTicket(body.reference);
    return jsonOk({ result });
  } catch (err) {
    return toErrorResponse(err);
  }
}
