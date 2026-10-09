import { requireUser } from "@/lib/auth";
import { applicationSchema, getApplication, submitApplication } from "@/lib/creatorApplications";
import { assertFeatureEnabled } from "@/lib/features";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { enforceRateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

/** The caller's creator application, their KYC standing, and whether they're already in. */
export async function GET(req: Request) {
  try {
    const auth = await requireUser(req);
    await assertFeatureEnabled("referrals");
    return jsonOk(await getApplication(auth.id));
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** Apply, update after we asked for more, or apply again after the wait. */
export async function POST(req: Request) {
  try {
    const auth = await requireUser(req);
    await assertFeatureEnabled("referrals");
    await enforceRateLimit(`inf-apply:${auth.id}`, 10, 60 * 60_000);
    await submitApplication(auth.id, applicationSchema.parse(await req.json()));
    return jsonOk(await getApplication(auth.id), 201);
  } catch (err) {
    return toErrorResponse(err);
  }
}
