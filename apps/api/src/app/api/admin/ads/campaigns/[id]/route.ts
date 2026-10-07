import { z } from "zod";
import { recordAdminAction, requireAdminActor, requireAdminOtp } from "@/lib/adminGuard";
import { decideCampaign } from "@/lib/ads";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * Approve (the ad starts showing to users) or reject with a reason the
 * advertiser sees (refunds them in full). Both change what users see or move
 * money, so both need a fresh authenticator code.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireAdminActor(req, { superOnly: true });
    const { id } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ApiError(404, "Not found", "not_found");
    const b = z
      .object({ approve: z.boolean(), reason: z.string().trim().max(300).optional() })
      .refine((v) => v.approve || (v.reason ?? "").length >= 3, "Give the advertiser a reason.")
      .parse(await req.json());
    await requireAdminOtp(req);
    const campaign = await decideCampaign(id, b.approve, b.approve ? null : b.reason!, actor.email);
    await recordAdminAction(req, actor, {
      action: b.approve ? "admin.ad.approved" : "admin.ad.rejected",
      summary: `Ad "${campaign.headline}" ${b.approve ? "approved" : `rejected: ${b.reason}`}`,
      resourceType: "AdCampaign",
      resourceId: id,
    });
    return jsonOk({ campaign });
  } catch (err) {
    return toErrorResponse(err);
  }
}
