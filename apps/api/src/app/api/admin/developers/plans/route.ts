import { z } from "zod";
import { recordAdminAction, requireAdminActor, requireAdminOtp } from "@/lib/adminGuard";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { PLAN_FIELD_BOUNDS, PLAN_IDS, getPlans, setPlans, type DevPlan, type PlanId } from "@/lib/devapi/plans";
import { LIMIT_DEFAULTS, getDevLimits, setDevLimits, type DevLimits } from "@/lib/devapi/limits";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await requireAdminActor(req, { superOnly: true });
    const [plans, limits] = await Promise.all([getPlans(), getDevLimits()]);
    return jsonOk({ plans: PLAN_IDS.map((id) => plans[id]), limits, bounds: PLAN_FIELD_BOUNDS });
  } catch (err) {
    return toErrorResponse(err);
  }
}

const planFields = z
  .object(
    Object.fromEntries(
      Object.entries(PLAN_FIELD_BOUNDS).map(([k, [min, max]]) => [k, z.number().int().min(min).max(max).optional()]),
    ) as Record<keyof typeof PLAN_FIELD_BOUNDS, z.ZodOptional<z.ZodNumber>>,
  )
  .extend({ name: z.string().trim().min(1).max(40).optional() })
  .strict();

const schema = z
  .object({
    plans: z.record(z.enum(PLAN_IDS), planFields).optional(),
    limits: z
      .object(
        Object.fromEntries(Object.keys(LIMIT_DEFAULTS).map((k) => [k, z.number().int().min(0).max(1_000_000_000_000).optional()])) as Record<
          keyof DevLimits,
          z.ZodOptional<z.ZodNumber>
        >,
      )
      .strict()
      .optional(),
  })
  .strict();

/** Change plan prices, rate limits and fees, and the default exposure limits. Needs a fresh authenticator code. */
export async function POST(req: Request) {
  try {
    const actor = await requireAdminActor(req, { superOnly: true });
    await requireAdminOtp(req);
    const b = schema.parse(await req.json());
    let plans = await getPlans();
    if (b.plans) {
      const next = Object.fromEntries(PLAN_IDS.map((id) => [id, { ...plans[id], ...(b.plans?.[id] ?? {}) }])) as Record<PlanId, Partial<DevPlan>>;
      plans = await setPlans(next, actor.email);
    }
    const limits = b.limits ? await setDevLimits(b.limits as Partial<DevLimits>, actor.email) : await getDevLimits();
    await recordAdminAction(req, actor, {
      action: "admin.developer.plans",
      summary: "Developer plans and limits updated",
      resourceType: "DeveloperPlans",
      details: b,
    });
    return jsonOk({ plans: PLAN_IDS.map((id) => plans[id]), limits });
  } catch (err) {
    return toErrorResponse(err);
  }
}
