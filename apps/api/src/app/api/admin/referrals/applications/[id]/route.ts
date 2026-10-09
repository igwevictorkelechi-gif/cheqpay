import { z } from "zod";
import { recordAdminAction, requireAdminActor, requireAdminOtp } from "@/lib/adminGuard";
import { decideApplication, getApplicationAdmin } from "@/lib/creatorApplications";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { getReferralSettings } from "@/lib/referrals";

export const dynamic = "force-dynamic";

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("approve"),
    code: z.string().min(4).max(40),
    commissionPercent: z.number().min(0).max(100),
    windowDays: z.number().int().min(1).max(3650).nullable(),
  }),
  z.object({ action: z.literal("reject"), reason: z.string().min(3).max(300) }),
  z.object({ action: z.literal("request_info"), note: z.string().min(3).max(500) }),
]);

const ID = /^[0-9a-f-]{36}$/i;

/** One application with the vetting panel's facts about the applicant. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminActor(req, { superOnly: true });
    const { id } = await params;
    if (!ID.test(id)) throw new ApiError(404, "Not found", "not_found");
    const settings = await getReferralSettings();
    return jsonOk({
      ...(await getApplicationAdmin(id)),
      defaults: { commissionPercent: settings.defaultCommissionBps / 100, windowDays: settings.defaultWindowDays },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

const ACTIONS = {
  approve: "admin.referral.application_approved",
  reject: "admin.referral.application_rejected",
  request_info: "admin.referral.application_info_requested",
} as const;

/** Approve (sets code, % and window — needs a fresh code), ask for more, or reject. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireAdminActor(req, { superOnly: true });
    const { id } = await params;
    if (!ID.test(id)) throw new ApiError(404, "Not found", "not_found");
    const b = schema.parse(await req.json());
    if (b.action === "approve") await requireAdminOtp(req);
    const { userId } = await decideApplication(id, actor.email, b);
    await recordAdminAction(req, actor, {
      action: ACTIONS[b.action],
      summary:
        b.action === "approve"
          ? `Approved creator ${b.code} at ${b.commissionPercent}%`
          : b.action === "reject"
            ? `Rejected creator application: ${b.reason}`
            : `Asked creator applicant for more: ${b.note}`,
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
