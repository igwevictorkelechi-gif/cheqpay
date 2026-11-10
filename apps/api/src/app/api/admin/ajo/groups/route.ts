import { requireAdminActor } from "@/lib/adminGuard";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { listAjoGroupsAdmin, type GroupFilter } from "@/lib/ajo/admin";

export const dynamic = "force-dynamic";

const FILTERS: GroupFilter[] = ["active", "forming", "completed", "cancelled", "arrears", "all"];

/** Admin: groups. ?status=active (default) | forming | completed | cancelled | arrears | all */
export async function GET(req: Request) {
  try {
    await requireAdminActor(req, { section: "ajo" });
    const s = (new URL(req.url).searchParams.get("status") ?? "active").toLowerCase() as GroupFilter;
    return jsonOk({ groups: await listAjoGroupsAdmin(FILTERS.includes(s) ? s : "active") });
  } catch (err) {
    return toErrorResponse(err);
  }
}
