import { requireUser } from "@/lib/auth";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { webPushUnsubscribeSchema } from "@/lib/validation";
import { removeSubscription } from "@/lib/webPush";

export const dynamic = "force-dynamic";

/** Stop notifying this browser. Only ever removes the caller's own subscription. */
export async function POST(req: Request) {
  try {
    const auth = await requireUser(req);
    const { endpoint } = webPushUnsubscribeSchema.parse(await req.json());
    const removed = await removeSubscription(auth.id, endpoint);
    return jsonOk({ removed });
  } catch (err) {
    return toErrorResponse(err);
  }
}
