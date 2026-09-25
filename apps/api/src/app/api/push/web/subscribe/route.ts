import { requireUser } from "@/lib/auth";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { enforceRateLimit } from "@/lib/ratelimit";
import { webPushSubscriptionSchema } from "@/lib/validation";
import { saveSubscription, webPushPublicKey } from "@/lib/webPush";

export const dynamic = "force-dynamic";

/** Let this browser receive the user's notifications. */
export async function POST(req: Request) {
  try {
    const auth = await requireUser(req);
    await enforceRateLimit(`webpush-sub:${auth.id}`, 10, 60 * 60_000);
    if (!webPushPublicKey()) {
      throw new ApiError(503, "Browser notifications aren't available yet", "webpush_disabled");
    }
    const sub = webPushSubscriptionSchema.parse(await req.json());
    await saveSubscription(auth.id, sub, req.headers.get("user-agent"));
    return jsonOk({ subscribed: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
