import { newScreen } from "@/lib/adsVenues";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { enforceRateLimit } from "@/lib/ratelimit";
import { clientIp } from "@/lib/requestContext";

export const dynamic = "force-dynamic";

/** A new venue screen asks for a 6-digit pairing code (shown on the TV for an admin to enter). */
export async function POST(req: Request) {
  try {
    await enforceRateLimit(`screen-pair:${clientIp(req) ?? "x"}`, 10, 10 * 60_000);
    return jsonOk(await newScreen(), 201);
  } catch (err) {
    return toErrorResponse(err);
  }
}
