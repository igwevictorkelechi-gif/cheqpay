import { z } from "zod";
import { recordAdminAction, requireAdminActor, requireAdminOtp } from "@/lib/adminGuard";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { decideApplication } from "@/lib/referrals";

export const dynamic = "force-dynamic";

const schema = z.discriminatedUnion("approve", [
  z.object({
    approve: z.literal(true),
    code: z.string().min(4).max(40),
    commissionPercent: z.number().min(0).max(100),
    windowDays: z.number().int().min(1).max(3650).nullable(),
  }),
  z.object({ approve: z.literal(false), reason: z.string().min(3).max(300) }),
]);

/** Approve an influencer application (sets their code, % and window — needs a fresh code) or reject it. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireAdminActor(req, { superOnly: true });
    const { id } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ApiError(404, "Not found", "not_found");
    const b = schema.parse(await req.json());
    if (b.approve) await requireAdminOtp(req);
    const { userId } = await decideApplication(id, actor.email, b);
    await recordAdminAction(req, actor, {
      action: b.approve ? "admin.referral.application_approved" : "admin.referral.application_rejected",
      summary: b.approve ? `Approved influencer ${b.code} at ${b.commissionPercent}%` : `Rejected influencer application: ${b.reason}`,
      userId,
      resourceType: "InfluencerApplication",
      resourceId: id,
      details: b,
    });
    return jsonOk({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
