import { jsonOk, toErrorResponse } from "@/lib/http";
import { enforceRateLimit } from "@/lib/ratelimit";
import { actorOf, requireDeveloper } from "@/lib/devapi/dashboard";
import { stepUpForLive } from "@/lib/devapi/dashboardWebhooks";
import { getSubscription } from "@/lib/devapi/billing";
import { getPlans } from "@/lib/devapi/plans";
import { currentPlan } from "@/lib/devapi/handler";
import { createEndpoint, endpointCreateSchema, endpointView, listEndpoints } from "@/lib/devapi/webhooks";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const s = await requireDeveloper(req);
    const mode = new URL(req.url).searchParams.get("mode");
    const endpoints = await listEndpoints(s.account.id, mode === "live" || mode === "test" ? mode : null);
    return jsonOk({ endpoints: endpoints.map((e) => endpointView(e)) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** Add an endpoint. The signing secret is in this response and never again. */
export async function POST(req: Request) {
  try {
    const s = await requireDeveloper(req);
    const body = endpointCreateSchema.parse(await req.json());
    stepUpForLive(s, body.mode);
    await enforceRateLimit(`dev:webhooks:create:${s.account.id}`, 20, 60 * 60_000);
    const plan = currentPlan(await getSubscription(s.account.id), await getPlans());
    const { endpoint, secret } = await createEndpoint(s.account, plan, body, actorOf(s));
    return jsonOk({ endpoint: endpointView(endpoint), secret }, 201);
  } catch (err) {
    return toErrorResponse(err);
  }
}
