import { z } from "zod";
import { heartbeat, screenToken } from "@/lib/adsVenues";
import { jsonOk, toErrorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

const schema = z.object({ plays: z.array(z.object({ campaignId: z.string().max(40), n: z.number().int().min(0).max(1000) })).max(50).default([]) });

/** A screen reports it's on (about once a minute) and what it played since the last report. */
export async function POST(req: Request) {
  try {
    const b = schema.parse(await req.json().catch(() => ({})));
    return jsonOk(await heartbeat(screenToken(req), b.plays));
  } catch (err) {
    return toErrorResponse(err);
  }
}
