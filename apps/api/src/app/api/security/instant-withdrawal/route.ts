import { prisma } from "@cheqpay/db";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

const schema = z.object({ enabled: z.boolean() });

/**
 * Toggle "instant withdrawal" — when enabled, crypto withdrawals skip the
 * per-request 2FA (AAL2) step. Security-sensitive, so it's audited.
 */
export async function POST(req: Request) {
  try {
    const auth = await requireUser(req);
    const { enabled } = schema.parse(await req.json());

    const user = await prisma.user.findUnique({ where: { id: auth.id } });
    if (!user) {
      throw new ApiError(404, "Profile not provisioned; POST /api/me first", "no_profile");
    }

    await prisma.user.update({
      where: { id: auth.id },
      data: { instantWithdrawal: enabled },
    });
    await prisma.auditLog.create({
      data: {
        userId: auth.id,
        action: enabled ? "security.instant_withdrawal.enabled" : "security.instant_withdrawal.disabled",
        resourceType: "User",
        resourceId: auth.id,
        details: {},
      },
    });

    return jsonOk({ instantWithdrawal: enabled });
  } catch (err) {
    return toErrorResponse(err);
  }
}
