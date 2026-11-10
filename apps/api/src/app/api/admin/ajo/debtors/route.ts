import { requireAdminActor } from "@/lib/adminGuard";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { listAjoDebtorsAdmin } from "@/lib/ajo/admin";

export const dynamic = "force-dynamic";

/** Admin: everyone in arrears, worst first. */
export async function GET(req: Request) {
  try {
    await requireAdminActor(req, { section: "ajo" });
    return jsonOk({ debtors: await listAjoDebtorsAdmin() });
  } catch (err) {
    return toErrorResponse(err);
  }
}
