import { z } from "zod";
import { recordAdminAction, requireAdminActor } from "@/lib/adminGuard";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { voidEarning } from "@/lib/referrals";

export const dynamic = "force-dynamic";

/** Void a held earning (e.g. suspected fraud) so it is never paid. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireAdminActor(req, { superOnly: true });
    const { id } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ApiError(404, "Not found", "not_found");
    const { reason } = z.object({ reason: z.string().min(3).max(300) }).parse(await req.json());
    await voidEarning(id, reason);
    await recordAdminAction(req, actor, { action: "admin.referral.earning_voided", summary: `Voided referral earning: ${reason}`, resourceType: "ReferralEarning", resourceId: id });
    return jsonOk({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
