import { z } from "zod";
import { recordAdminAction, requireAdminActor, requireAdminOtp } from "@/lib/adminGuard";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { TASK_METRICS, listTasksAdmin, upsertTask } from "@/lib/referrals";

export const dynamic = "force-dynamic";

const schema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().min(3).max(120),
  description: z.string().max(2000).default(""),
  kind: z.enum(["AUTO", "PROOF"]),
  metric: z.enum(Object.keys(TASK_METRICS) as [keyof typeof TASK_METRICS, ...(keyof typeof TASK_METRICS)[]]).nullable().default(null),
  /** A count, or ₦ for volume. */
  target: z.number().positive().max(1e12).nullable().default(null),
  reward: z.number().positive().max(100_000_000),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().nullable().default(null),
  assigned: z.array(z.string().min(2).max(200)).max(200).default([]),
  active: z.boolean().default(true),
});

export async function GET(req: Request) {
  try {
    await requireAdminActor(req, { superOnly: true });
    return jsonOk({ tasks: await listTasksAdmin(), metrics: TASK_METRICS });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** Create or edit a task. Tasks pay out, so saving needs a fresh code. */
export async function POST(req: Request) {
  try {
    const actor = await requireAdminActor(req, { superOnly: true });
    await requireAdminOtp(req);
    const b = schema.parse(await req.json());
    const target =
      b.target === null ? null : b.metric === "volume_ngn" ? BigInt(Math.round(b.target * 100)) : BigInt(Math.round(b.target));
    const id = await upsertTask(
      {
        id: b.id, title: b.title, description: b.description, kind: b.kind, metric: b.metric, target,
        rewardMinor: BigInt(Math.round(b.reward * 100)), startsAt: b.startsAt ? new Date(b.startsAt) : new Date(),
        endsAt: b.endsAt ? new Date(b.endsAt) : null, assigned: b.assigned, active: b.active,
      },
      actor.email,
    );
    await recordAdminAction(req, actor, {
      action: b.id ? "admin.referral.task_updated" : "admin.referral.task_created",
      summary: `Influencer task "${b.title}" (₦${b.reward})`,
      resourceType: "InfluencerTask",
      resourceId: id,
      details: b,
    });
    return jsonOk({ id });
  } catch (err) {
    return toErrorResponse(err);
  }
}
