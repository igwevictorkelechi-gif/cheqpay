import { screenState, screenToken } from "@/lib/adsVenues";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { enforceRateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

/** What a screen shows: its pairing code until paired, then today's ads for its venue. */
export async function GET(req: Request) {
  try {
    const token = screenToken(req);
    await enforceRateLimit(`screen-state:${(token ?? "").slice(0, 16)}`, 30, 60_000);
    return jsonOk(await screenState(token));
  } catch (err) {
    return toErrorResponse(err);
  }
}
