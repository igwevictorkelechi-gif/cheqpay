import { jsonOk, toErrorResponse } from "@/lib/http";
import { enforceRateLimit } from "@/lib/ratelimit";
import { submitApplication } from "@/lib/devapi/accounts";
import { actorOf, requireDeveloper, requireStepUp } from "@/lib/devapi/dashboard";
import { dashboardAccountView } from "@/lib/devapi/serialize";

export const dynamic = "force-dynamic";
// The registration certificate travels as a base64 data URL inside the JSON.
export const maxDuration = 30;

/**
 * Apply for live access: business details and the CAC certificate. Needs 2FA
 * on the session — going live without a second factor isn't allowed.
 */
export async function POST(req: Request) {
  try {
    const s = await requireDeveloper(req);
    requireStepUp(s.user);
    await enforceRateLimit(`dev:application:${s.user.id}`, 5, 60 * 60_000);
    const account = await submitApplication(s.account, await req.json(), actorOf(s));
    return jsonOk({ account: dashboardAccountView(account) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
