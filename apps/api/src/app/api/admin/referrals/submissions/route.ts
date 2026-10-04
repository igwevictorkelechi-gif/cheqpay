import { requireAdminActor } from "@/lib/adminGuard";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { listSubmissionsAdmin } from "@/lib/referrals";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await requireAdminActor(req, { superOnly: true });
    const s = (new URL(req.url).searchParams.get("status") ?? "PENDING").toUpperCase();
    return jsonOk({ submissions: await listSubmissionsAdmin(["PENDING", "APPROVED", "REJECTED", "ALL"].includes(s) ? s : "PENDING") });
  } catch (err) {
    return toErrorResponse(err);
  }
}
