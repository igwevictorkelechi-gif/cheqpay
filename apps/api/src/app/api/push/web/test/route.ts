import { requireUser } from "@/lib/auth";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { enforceRateLimit } from "@/lib/ratelimit";
import { sendWebPush, webPushPublicKey } from "@/lib/webPush";

export const dynamic = "force-dynamic";

/** Send the caller a test notification on every browser they've turned notifications on in. */
export async function POST(req: Request) {
  try {
    const auth = await requireUser(req);
    await enforceRateLimit(`webpush-test:${auth.id}`, 5, 60 * 60_000);
    if (!webPushPublicKey()) {
      throw new ApiError(503, "Browser notifications aren't available yet", "webpush_disabled");
    }
    const sent = await sendWebPush(auth.id, {
      title: "CheqPay notifications are on",
      body: "This is a test. You'll get alerts like this for deposits, withdrawals and security.",
      category: "security",
      url: "/notifications/",
    });
    return jsonOk({ sent });
  } catch (err) {
    return toErrorResponse(err);
  }
}
