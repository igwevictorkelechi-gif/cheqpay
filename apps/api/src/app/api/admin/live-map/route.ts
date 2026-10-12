import { requireAdmin } from "@/lib/auth";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { feedSince, liveKpis, topPlaces, transactionFeed, userCells, type MapCell } from "@/lib/liveMap";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/live-map?since=<iso>
 *
 * The admin Live map's data: user cells for the heat map (with how many are
 * active now), transactions since `since` for the live feed, and headline
 * numbers. Polled every few seconds by an open map, so the user cells, which
 * scan every account, are reused for 30 seconds per instance.
 */
let cellCache: { at: number; cells: MapCell[] } | null = null;
const CELL_TTL_MS = 30_000;

export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    const since = feedSince(new URL(req.url).searchParams.get("since"));

    if (!cellCache || Date.now() - cellCache.at > CELL_TTL_MS) {
      cellCache = { at: Date.now(), cells: await userCells() };
    }
    const cells = cellCache.cells;
    const [transactions, kpis] = await Promise.all([transactionFeed(since), liveKpis(cells)]);

    const res = jsonOk({
      now: new Date().toISOString(),
      cells,
      transactions,
      kpis,
      topCities: topPlaces(cells, "city"),
      topCountries: topPlaces(cells, "country"),
    });
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (err) {
    return toErrorResponse(err);
  }
}
