import { z } from "zod";
import { recordAdminAction, requireAdminActor, requireAdminOtp } from "@/lib/adminGuard";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { listInfluencersAdmin, upsertInfluencer } from "@/lib/referrals";

export const dynamic = "force-dynamic";

const schema = z.object({
  user: z.string().min(2).max(200), // email or @username
  code: z.string().min(4).max(40),
  commissionPercent: z.number().min(0).max(100),
  windowDays: z.number().int().min(1).max(3650).nullable(),
  active: z.boolean().default(true),
});

export async function GET(req: Request) {
  try {
    await requireAdminActor(req, { superOnly: true });
    return jsonOk({ influencers: await listInfluencersAdmin() });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** Make someone an influencer, or change their code, % or window. Sets what we pay, so it needs a fresh code. */
export async function POST(req: Request) {
  try {
    const actor = await requireAdminActor(req, { superOnly: true });
    await requireAdminOtp(req);
    const body = schema.parse(await req.json());
    const userId = await upsertInfluencer(body);
    await recordAdminAction(req, actor, {
      action: "admin.referral.influencer_set",
      summary: `Influencer ${body.code}: ${body.commissionPercent}% for ${body.windowDays ?? "∞"} days${body.active ? "" : " (paused)"}`,
      userId,
      resourceType: "ReferralCode",
      details: body,
    });
    return jsonOk({ userId });
  } catch (err) {
    return toErrorResponse(err);
  }
}
