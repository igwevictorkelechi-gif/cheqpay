import { z } from "zod";
import { recordAdminAction, requireAdminActor, requireAdminOtp } from "@/lib/adminGuard";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { reviewApplication } from "@/lib/devapi/accounts";
import { dashboardAccountView } from "@/lib/devapi/serialize";

export const dynamic = "force-dynamic";

// Limits arrive in naira/dollars from the form; empty means "use the platform default".
const money = z.number().min(0).max(10_000_000_000).nullable().optional();
const schema = z
  .object({
    approve: z.boolean(),
    note: z.string().max(1000).optional(),
    limits: z
      .object({ daily_out_ngn: money, daily_out_usd: money, max_float_ngn: money, max_float_usd: money })
      .strict()
      .optional(),
  })
  .strict();

const minor = (v: number | null | undefined) => (v === null || v === undefined ? null : BigInt(Math.round(v * 100)));

/** Approve (live access opens) or reject (the business sees the note) an application. Needs a fresh authenticator code. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireAdminActor(req, { superOnly: true });
    await requireAdminOtp(req);
    const { id } = await params;
    const b = schema.parse(await req.json());
    const account = await reviewApplication(
      id,
      {
        approve: b.approve,
        note: b.note,
        limits: {
          dailyOutNgnMinor: minor(b.limits?.daily_out_ngn),
          dailyOutUsdMinor: minor(b.limits?.daily_out_usd),
          maxFloatNgnMinor: minor(b.limits?.max_float_ngn),
          maxFloatUsdMinor: minor(b.limits?.max_float_usd),
        },
      },
      actor.email,
    );
    await recordAdminAction(req, actor, {
      action: b.approve ? "admin.developer.approve" : "admin.developer.reject",
      summary: `Developer ${b.approve ? "approved" : "rejected"}: ${account.legal_name ?? account.business_name}`,
      userId: account.owner_user_id,
      resourceType: "DeveloperAccount",
      resourceId: id,
      details: { note: b.note ?? null, limits: b.limits ?? null },
    });
    return jsonOk({ account: dashboardAccountView(account) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
