import { requireAdminActor } from "@/lib/adminGuard";
import { ADMIN_STATUSES, listApplicationsAdmin } from "@/lib/creatorApplications";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { getReferralSettings } from "@/lib/referrals";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await requireAdminActor(req, { superOnly: true });
    const q = new URL(req.url).searchParams;
    const s = (q.get("status") ?? "PENDING").toUpperCase();
    const settings = await getReferralSettings();
    return jsonOk({
      applications: await listApplicationsAdmin((ADMIN_STATUSES as readonly string[]).includes(s) ? s : "PENDING", q.get("q") ?? ""),
      defaults: { commissionPercent: settings.defaultCommissionBps / 100, windowDays: settings.defaultWindowDays },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
