import { jsonOk, toErrorResponse } from "@/lib/http";
import { webPushPublicKey } from "@/lib/webPush";

export const dynamic = "force-dynamic";

/** Public: the key browsers subscribe with. `null` means web push is off. */
export async function GET() {
  try {
    return jsonOk({ publicKey: webPushPublicKey() });
  } catch (err) {
    return toErrorResponse(err);
  }
}
