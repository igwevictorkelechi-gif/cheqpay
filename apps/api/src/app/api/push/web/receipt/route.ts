import { jsonOk, toErrorResponse } from "@/lib/http";
import { enforceRateLimit } from "@/lib/ratelimit";
import { clientIp } from "@/lib/requestContext";
import { webPushReceiptSchema } from "@/lib/validation";
import { recordReceipt } from "@/lib/webPush";

export const dynamic = "force-dynamic";

/**
 * The service worker reports that a notification arrived on the device or was
 * tapped. It has no login, so this only ever records against a subscription
 * and a message we already know, and tells the caller nothing either way.
 */
export async function POST(req: Request) {
  try {
    await enforceRateLimit(`webpush-receipt:${clientIp(req) ?? "unknown"}`, 120, 60 * 60_000);
    const { id, endpoint, event } = webPushReceiptSchema.parse(await req.json());
    await recordReceipt(id, endpoint, event);
    return jsonOk({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
