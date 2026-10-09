import { requireUser } from "@/lib/auth";
import { codeAvailability } from "@/lib/creatorApplications";
import { assertFeatureEnabled } from "@/lib/features";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { enforceRateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

/** Live "is this creator code free?" check while applying. */
export async function GET(req: Request) {
  try {
    const auth = await requireUser(req);
    await assertFeatureEnabled("referrals");
    await enforceRateLimit(`inf-code:${auth.id}`, 60, 60_000);
    const code = (new URL(req.url).searchParams.get("code") ?? "").slice(0, 40);
    return jsonOk(await codeAvailability(auth.id, code));
  } catch (err) {
    return toErrorResponse(err);
  }
}
