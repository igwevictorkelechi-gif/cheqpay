import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { assertFeatureEnabled } from "@/lib/features";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { enforceRateLimit } from "@/lib/ratelimit";
import { applyReferral } from "@/lib/referrals";

export const dynamic = "force-dynamic";

/** Add the referral code of whoever invited you (once, in your first week). */
export async function POST(req: Request) {
  try {
    const auth = await requireUser(req);
    await assertFeatureEnabled("referrals");
    await enforceRateLimit(`ref-apply:${auth.id}`, 10, 60 * 60_000);
    const { code } = z.object({ code: z.string().min(1).max(40) }).parse(await req.json());
    return jsonOk(await applyReferral(auth.id, code));
  } catch (err) {
    return toErrorResponse(err);
  }
}
