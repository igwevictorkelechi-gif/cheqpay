import { jsonOk, toErrorResponse } from "@/lib/http";
import { requireDeveloper } from "@/lib/devapi/dashboard";
import { endpointFor } from "@/lib/devapi/dashboardWebhooks";
import { listDeliveries } from "@/lib/devapi/webhooks";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** The endpoint's recent deliveries: status, attempts, the last response code or error. */
export async function GET(req: Request, { params }: Ctx) {
  try {
    const s = await requireDeveloper(req);
    const endpoint = await endpointFor(s, (await params).id);
    return jsonOk({ deliveries: await listDeliveries(s.account.id, endpoint.id, 50) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
