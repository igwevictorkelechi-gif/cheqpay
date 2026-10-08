import { withApi } from "@/lib/devapi/handler";
import { getPlans } from "@/lib/devapi/plans";
import { liveAccessProblem } from "@/lib/devapi/billing";
import { effectiveLimits, getDevLimits } from "@/lib/devapi/limits";
import { accountObject } from "@/lib/devapi/serialize";

export const dynamic = "force-dynamic";

/** The account this key belongs to: plan, mode and (live) limits. */
export const GET = withApi({ scope: "account:read" }, async (ctx) => {
  const [plans, limits] = await Promise.all([getPlans(), getDevLimits()]);
  const liveEnabled = liveAccessProblem(ctx.account, ctx.subscription, plans) === null;
  return { body: accountObject(ctx.account, ctx.mode, ctx.plan, liveEnabled, effectiveLimits(ctx.account, limits)) };
});
