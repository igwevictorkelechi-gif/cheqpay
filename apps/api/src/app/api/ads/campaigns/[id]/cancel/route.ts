import { requireUser } from "@/lib/auth";
import { cancelCampaign } from "@/lib/ads";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Stop a campaign. Days that haven't run are refunded to the balance. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireUser(req);
    const { id } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ApiError(404, "Not found", "not_found");
    return jsonOk({ campaign: await cancelCampaign(auth.id, id) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
