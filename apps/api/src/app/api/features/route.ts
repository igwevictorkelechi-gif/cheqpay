import { jsonOk, toErrorResponse } from "@/lib/http";
import { getFeatureFlags } from "@/lib/features";

export const dynamic = "force-dynamic";

/** Public: current feature switches, so clients can hide disabled features. */
export async function GET() {
  try {
    return jsonOk({ features: await getFeatureFlags() });
  } catch (err) {
    return toErrorResponse(err);
  }
}
