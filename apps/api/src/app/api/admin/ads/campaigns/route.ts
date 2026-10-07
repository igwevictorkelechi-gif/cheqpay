import { requireAdminActor } from "@/lib/adminGuard";
import { CAMPAIGN_STATUSES, listCampaignsAdmin, type CampaignStatus } from "@/lib/ads";
import { jsonOk, toErrorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Ad campaigns for review (waiting first), or filtered by status. */
export async function GET(req: Request) {
  try {
    await requireAdminActor(req, { superOnly: true });
    const s = new URL(req.url).searchParams.get("status") ?? "PENDING_REVIEW";
    const status = s === "ALL" || (CAMPAIGN_STATUSES as readonly string[]).includes(s) ? (s as CampaignStatus | "ALL") : "PENDING_REVIEW";
    return jsonOk({ campaigns: await listCampaignsAdmin(status) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
