import { jsonOk, toErrorResponse } from "@/lib/http";
import { readPin, requireTransactionPin } from "@/lib/transactionPin";
import { resumeAfterStop } from "@/lib/devapi/accounts";
import { actorOf, requireDeveloper, requireStepUp } from "@/lib/devapi/dashboard";
import { dashboardAccountView } from "@/lib/devapi/serialize";

export const dynamic = "force-dynamic";

/** Lift your own emergency stop. Unlike pressing it, this needs 2FA and your PIN. */
export async function POST(req: Request) {
  try {
    const s = await requireDeveloper(req);
    requireStepUp(s.user);
    await requireTransactionPin(s.user.id, readPin(req), { enforce: true });
    return jsonOk({ account: dashboardAccountView(await resumeAfterStop(s.account, actorOf(s))) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
