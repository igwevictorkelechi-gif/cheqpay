import { jsonOk, toErrorResponse } from "@/lib/http";
import { enforceRateLimit } from "@/lib/ratelimit";
import { requireDeveloper } from "@/lib/devapi/dashboard";
import { endpointFor } from "@/lib/devapi/dashboardWebhooks";
import { sendTestEvent } from "@/lib/devapi/webhooks";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Send a signed `ping` event to the endpoint now and report what it answered. */
export async function POST(req: Request, { params }: Ctx) {
  try {
    const s = await requireDeveloper(req);
    const endpoint = await endpointFor(s, (await params).id);
    await enforceRateLimit(`dev:webhooks:test:${s.account.id}`, 30, 60 * 60_000);
    return jsonOk({ delivery: await sendTestEvent(s.account, endpoint) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
