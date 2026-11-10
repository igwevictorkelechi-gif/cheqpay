import { requireAdminActor } from "@/lib/adminGuard";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { ajoAdminOverview } from "@/lib/ajo/admin";

export const dynamic = "force-dynamic";

/** Admin: Ajo at a glance — money in plans, groups by state, arrears, what's due next. */
export async function GET(req: Request) {
  try {
    await requireAdminActor(req, { section: "ajo" });
    return jsonOk(await ajoAdminOverview());
  } catch (err) {
    return toErrorResponse(err);
  }
}
