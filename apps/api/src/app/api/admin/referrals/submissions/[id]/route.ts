import { z } from "zod";
import { recordAdminAction, requireAdminActor, requireAdminOtp } from "@/lib/adminGuard";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { decideSubmission } from "@/lib/referrals";

export const dynamic = "force-dynamic";

/** Approve (pays the task reward after the hold — needs a fresh code) or reject a proof submission. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireAdminActor(req, { superOnly: true });
    const { id } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ApiError(404, "Not found", "not_found");
    const b = z.object({ approve: z.boolean(), reason: z.string().max(300).optional() }).parse(await req.json());
    if (b.approve) await requireAdminOtp(req);
    await decideSubmission(id, actor.email, b.approve, b.reason);
    await recordAdminAction(req, actor, {
      action: b.approve ? "admin.referral.submission_approved" : "admin.referral.submission_rejected",
      summary: `Task submission ${b.approve ? "approved" : `rejected: ${b.reason ?? ""}`}`,
      resourceType: "TaskSubmission",
      resourceId: id,
    });
    return jsonOk({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
