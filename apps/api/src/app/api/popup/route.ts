import { jsonOk, toErrorResponse } from "@/lib/http";
import { getAppPopup } from "@/lib/popup";

export const dynamic = "force-dynamic";

/** Public: the current in-app popup, or null when none is enabled. */
export async function GET() {
  try {
    const popup = await getAppPopup();
    return jsonOk({ popup: popup && popup.enabled ? popup : null });
  } catch (err) {
    return toErrorResponse(err);
  }
}
