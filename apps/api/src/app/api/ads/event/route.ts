import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { recordAdEvent } from "@/lib/ads";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { enforceRateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

const schema = z.object({
  campaignId: z.string().uuid(),
  channel: z.string().regex(/^placement:(home|receipt|paybills)$/),
  kind: z.enum(["view", "click"]),
});

/** A person saw or tapped an ad. A view counts at most once a minute per person per ad, a tap once. */
export async function POST(req: Request) {
  try {
    const auth = await requireUser(req);
    const b = schema.parse(await req.json());
    try {
      await enforceRateLimit(`ad-ev:${b.kind}:${auth.id}:${b.campaignId}`, 1, b.kind === "view" ? 60_000 : 30 * 60_000);
    } catch {
      return jsonOk({ counted: false });
    }
    return jsonOk({ counted: await recordAdEvent(auth.id, b.campaignId, b.channel, b.kind) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
