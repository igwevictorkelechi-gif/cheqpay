import { requireAdminActor } from "@/lib/adminGuard";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { listAjoPlansAdmin } from "@/lib/ajo/admin";

export const dynamic = "force-dynamic";

/** Admin: personal plans. ?status=active (default) | matured | broken | all */
export async function GET(req: Request) {
  try {
    await requireAdminActor(req, { section: "ajo" });
    const s = (new URL(req.url).searchParams.get("status") ?? "active").toLowerCase();
    const status = (["active", "matured", "broken", "all"] as const).find((x) => x === s) ?? "active";
    return jsonOk({ plans: await listAjoPlansAdmin(status) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
