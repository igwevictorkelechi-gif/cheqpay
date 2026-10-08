import { jsonOk, toErrorResponse } from "@/lib/http";
import { enforceRateLimit } from "@/lib/ratelimit";
import { actorOf, requireDeveloper } from "@/lib/devapi/dashboard";
import { endpointFor, stepUpForLive } from "@/lib/devapi/dashboardWebhooks";
import { endpointView, rollEndpointSecret } from "@/lib/devapi/webhooks";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** A new signing secret, shown once. The old one keeps working for 24 hours. */
export async function POST(req: Request, { params }: Ctx) {
  try {
    const s = await requireDeveloper(req);
    const endpoint = await endpointFor(s, (await params).id);
    stepUpForLive(s, endpoint.mode);
    await enforceRateLimit(`dev:webhooks:roll:${s.account.id}`, 10, 60 * 60_000);
    const { endpoint: updated, secret } = await rollEndpointSecret(s.account, endpoint, actorOf(s));
    return jsonOk({ endpoint: endpointView(updated), secret });
  } catch (err) {
    return toErrorResponse(err);
  }
}
