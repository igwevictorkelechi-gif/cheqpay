import { z } from "zod";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { enforceRateLimit } from "@/lib/ratelimit";
import { readPin, requireTransactionPin } from "@/lib/transactionPin";
import { cancelPlan, changePlan, getSubscription } from "@/lib/devapi/billing";
import { requireDeveloper, requireStepUp } from "@/lib/devapi/dashboard";
import { alertOwner } from "@/lib/devapi/audit";
import { subscriptionView } from "@/lib/devapi/serialize";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const s = await requireDeveloper(req);
    return jsonOk({ subscription: subscriptionView(await getSubscription(s.account.id)) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

const schema = z.object({ plan_id: z.string() }).strict();

/**
 * Choose a plan. Paid from your main NGN wallet: a new plan or an upgrade is
 * charged now (an upgrade prorated), a downgrade waits for the period's end.
 * Needs 2FA and your transaction PIN.
 */
export async function POST(req: Request) {
  try {
    const s = await requireDeveloper(req);
    requireStepUp(s.user);
    await enforceRateLimit(`dev:plan:${s.account.id}`, 10, 60 * 60_000);
    const { plan_id } = schema.parse(await req.json());
    await requireTransactionPin(s.user.id, readPin(req), { enforce: true });
    const change = await changePlan(s.account, plan_id, { ip: s.ip, userAgent: s.userAgent });
    if (change.kind !== "unchanged") {
      alertOwner(s.account, {
        title: "Your developer plan changed",
        body:
          change.kind === "downgrade_scheduled"
            ? `You'll move to the ${plan_id} plan at the end of this billing period.`
            : `You're on the ${plan_id} plan.${"chargedMinor" in change && change.chargedMinor > 0n ? ` ₦${(Number(change.chargedMinor) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })} was charged to your main wallet.` : ""}`,
      });
    }
    return jsonOk({
      change: { kind: change.kind, charged: "chargedMinor" in change ? Number(change.chargedMinor) : 0 },
      subscription: subscriptionView(await getSubscription(s.account.id)),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** Cancel at the end of the current period. Needs 2FA. */
export async function DELETE(req: Request) {
  try {
    const s = await requireDeveloper(req);
    requireStepUp(s.user);
    const sub = await cancelPlan(s.account, { ip: s.ip, userAgent: s.userAgent });
    return jsonOk({ subscription: subscriptionView(sub) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
