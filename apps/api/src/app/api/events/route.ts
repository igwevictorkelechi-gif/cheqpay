import { requireUser } from "@/lib/auth";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { assertFeatureEnabled } from "@/lib/features";
import { listActiveEvents } from "@/lib/events";

export const dynamic = "force-dynamic";

/** The storefront: active events with their tiers. */
export async function GET(req: Request) {
  try {
    await requireUser(req);
    await assertFeatureEnabled("events");
    const events = await listActiveEvents();
    return jsonOk({ events });
  } catch (err) {
    return toErrorResponse(err);
  }
}
