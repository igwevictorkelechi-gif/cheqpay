import { jsonOk, toErrorResponse } from "@/lib/http";
import { getSupportContact } from "@/lib/settings";

export const dynamic = "force-dynamic";

/** Public: the support contact details shown on the app Help & Support page. */
export async function GET() {
  try {
    return jsonOk(await getSupportContact());
  } catch (err) {
    return toErrorResponse(err);
  }
}
