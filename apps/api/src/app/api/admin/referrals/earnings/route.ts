import { requireAdminActor } from "@/lib/adminGuard";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { earningsOverviewAdmin } from "@/lib/referrals";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await requireAdminActor(req, { superOnly: true });
    return jsonOk(await earningsOverviewAdmin());
  } catch (err) {
    return toErrorResponse(err);
  }
}
