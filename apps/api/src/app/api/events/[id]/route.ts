import { requireUser } from "@/lib/auth";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { assertFeatureEnabled } from "@/lib/features";
import { getActiveEvent } from "@/lib/events";

export const dynamic = "force-dynamic";

/** One event for the storefront. */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    await requireUser(req);
    await assertFeatureEnabled("events");
    const event = await getActiveEvent(params.id);
    return jsonOk({ event });
  } catch (err) {
    return toErrorResponse(err);
  }
}
