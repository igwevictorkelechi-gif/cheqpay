import { requireUser } from "@/lib/auth";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { assertFeatureEnabled } from "@/lib/features";
import { EVENT_CATEGORIES, listActiveEvents, listEventFacets } from "@/lib/events";

export const dynamic = "force-dynamic";

/**
 * The storefront: active events with their tiers. Optional `q` (search text),
 * `city`, `category` and `free=1` narrow the list; `filters` lists the cities and
 * categories that currently have events, for the filter chips.
 */
export async function GET(req: Request) {
  try {
    await requireUser(req);
    await assertFeatureEnabled("events");
    const url = new URL(req.url);
    const [events, facets] = await Promise.all([
      listActiveEvents({
        q: url.searchParams.get("q") ?? undefined,
        city: url.searchParams.get("city") ?? undefined,
        category: url.searchParams.get("category") ?? undefined,
        free: url.searchParams.get("free") === "1",
      }),
      listEventFacets(),
    ]);
    return jsonOk({ events, filters: { ...facets, allCategories: EVENT_CATEGORIES } });
  } catch (err) {
    return toErrorResponse(err);
  }
}
