import { fromPublicId } from "@cheqpay/devapi";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { enforceRateLimit } from "@/lib/ratelimit";
import { requireDeveloper } from "@/lib/devapi/dashboard";
import { resendDelivery } from "@/lib/devapi/webhooks";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Try a delivery once more, now. */
export async function POST(req: Request, { params }: Ctx) {
  try {
    const s = await requireDeveloper(req);
    await enforceRateLimit(`dev:webhooks:resend:${s.account.id}`, 120, 60 * 60_000);
    const id = fromPublicId("delivery", (await params).id);
    const delivery = id ? await resendDelivery(s.account.id, id) : null;
    if (!delivery) throw new ApiError(404, "No such delivery.", "not_found");
    return jsonOk({ delivery });
  } catch (err) {
    return toErrorResponse(err);
  }
}
