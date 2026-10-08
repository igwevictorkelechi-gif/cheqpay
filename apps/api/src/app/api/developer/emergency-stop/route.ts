import { jsonOk, toErrorResponse } from "@/lib/http";
import { emergencyStop } from "@/lib/devapi/accounts";
import { actorOf, requireDeveloper } from "@/lib/devapi/dashboard";

export const dynamic = "force-dynamic";

/**
 * Revoke every live key and pause money movement, in one press. Needs only the
 * signed-in session on purpose: it can only take access away, and in an
 * emergency every extra step is a delay.
 */
export async function POST(req: Request) {
  try {
    const s = await requireDeveloper(req);
    return jsonOk(await emergencyStop(s.account, actorOf(s)));
  } catch (err) {
    return toErrorResponse(err);
  }
}
