import { requireAdminActor } from "@/lib/adminGuard";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { adminReconciliation } from "@/lib/devapi/admin";

export const dynamic = "force-dynamic";

/** Live developer money in total, and any wallet whose balance its ledger doesn't prove. */
export async function GET(req: Request) {
  try {
    await requireAdminActor(req, { superOnly: true });
    return jsonOk(await adminReconciliation());
  } catch (err) {
    return toErrorResponse(err);
  }
}
