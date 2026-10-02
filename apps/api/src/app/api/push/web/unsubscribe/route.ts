import { requireUser } from "@/lib/auth";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { enforceRateLimit } from "@/lib/ratelimit";
import { clientIp } from "@/lib/requestContext";
import { webPushUnsubscribeSchema } from "@/lib/validation";
import { removeSubscription, removeSubscriptionBySecret } from "@/lib/webPush";

export const dynamic = "force-dynamic";

/**
 * Stop notifying this browser. Signed in, it only ever removes the caller's own
 * subscription. Without a session — the browser is signing out, so the token
 * is already gone — it must send the subscription's auth secret, which only
 * that browser holds.
 */
export async function POST(req: Request) {
  try {
    const body = webPushUnsubscribeSchema.parse(await req.json());
    if (/^Bearer \S+/.test(req.headers.get("authorization") ?? "")) {
      const auth = await requireUser(req);
      return jsonOk({ removed: await removeSubscription(auth.id, body.endpoint) });
    }
    if (!body.auth) throw new ApiError(401, "Sign in to change notifications", "unauthorized");
    await enforceRateLimit(`webpush-unsub:${clientIp(req) ?? "unknown"}`, 30, 60 * 60_000);
    return jsonOk({ removed: await removeSubscriptionBySecret(body.endpoint, body.auth) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
