import { requireAdminActor } from "@/lib/adminGuard";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { getReferralSettings, listApplicationsAdmin } from "@/lib/referrals";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await requireAdminActor(req, { superOnly: true });
    const s = (new URL(req.url).searchParams.get("status") ?? "PENDING").toUpperCase();
    const settings = await getReferralSettings();
    return jsonOk({
      applications: await listApplicationsAdmin(["PENDING", "APPROVED", "REJECTED", "ALL"].includes(s) ? s : "PENDING"),
      defaults: { commissionPercent: settings.defaultCommissionBps / 100, windowDays: settings.defaultWindowDays },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
