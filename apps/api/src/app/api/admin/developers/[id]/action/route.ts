import { z } from "zod";
import { recordAdminAction, requireAdminActor, requireAdminOtp } from "@/lib/adminGuard";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { adminAccountAction, type AdminAccountAction } from "@/lib/devapi/accounts";
import { dashboardAccountView } from "@/lib/devapi/serialize";

export const dynamic = "force-dynamic";

const reason = z.string().trim().min(10, "Give a reason (at least 10 characters)").max(500);
const money = z.number().min(0).max(10_000_000_000).nullable();
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("suspend"), reason }).strict(),
  z.object({ action: z.literal("unsuspend") }).strict(),
  z.object({ action: z.literal("freeze"), reason }).strict(),
  z.object({ action: z.literal("unfreeze") }).strict(),
  z.object({ action: z.literal("revoke_keys"), mode: z.enum(["test", "live"]).optional() }).strict(),
  z.object({ action: z.literal("require_ip_allowlist"), value: z.boolean() }).strict(),
  z
    .object({ action: z.literal("set_limits"), daily_out_ngn: money, daily_out_usd: money, max_float_ngn: money, max_float_usd: money })
    .strict(),
]);

const minor = (v: number | null) => (v === null ? null : BigInt(Math.round(v * 100)));

/** Suspend, freeze, revoke keys, change limits. Every one needs a fresh authenticator code. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireAdminActor(req, { superOnly: true });
    await requireAdminOtp(req);
    const { id } = await params;
    const b = schema.parse(await req.json());
    const action: AdminAccountAction =
      b.action === "set_limits"
        ? {
            action: "set_limits",
            dailyOutNgnMinor: minor(b.daily_out_ngn),
            dailyOutUsdMinor: minor(b.daily_out_usd),
            maxFloatNgnMinor: minor(b.max_float_ngn),
            maxFloatUsdMinor: minor(b.max_float_usd),
          }
        : b;
    const account = await adminAccountAction(id, action, actor.email);
    await recordAdminAction(req, actor, {
      action: `admin.developer.${b.action}`,
      summary: `Developer ${b.action.replace(/_/g, " ")}: ${account.business_name}`,
      userId: account.owner_user_id,
      resourceType: "DeveloperAccount",
      resourceId: id,
      details: b,
    });
    return jsonOk({ account: dashboardAccountView(account) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
