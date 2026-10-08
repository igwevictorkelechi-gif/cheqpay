import { jsonOk, toErrorResponse } from "@/lib/http";
import { actorOf, requireDeveloper } from "@/lib/devapi/dashboard";
import { endpointFor, stepUpForLive } from "@/lib/devapi/dashboardWebhooks";
import { deleteEndpoint, endpointUpdateSchema, endpointView, updateEndpoint } from "@/lib/devapi/webhooks";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Change an endpoint's URL, events or description, or switch it on and off. */
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const s = await requireDeveloper(req);
    const endpoint = await endpointFor(s, (await params).id);
    stepUpForLive(s, endpoint.mode);
    const patch = endpointUpdateSchema.parse(await req.json());
    return jsonOk({ endpoint: endpointView(await updateEndpoint(s.account, endpoint, patch, actorOf(s))) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(req: Request, { params }: Ctx) {
  try {
    const s = await requireDeveloper(req);
    const endpoint = await endpointFor(s, (await params).id);
    stepUpForLive(s, endpoint.mode);
    await deleteEndpoint(s.account, endpoint, actorOf(s));
    return jsonOk({ deleted: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
