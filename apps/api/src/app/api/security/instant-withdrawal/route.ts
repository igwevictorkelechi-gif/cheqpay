import { prisma } from "@cheqpay/db";
import { z } from "zod";
import { requireMfa, requireUser } from "@/lib/auth";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { enforceRateLimit } from "@/lib/ratelimit";
import { readPin, requireTransactionPin } from "@/lib/transactionPin";

export const dynamic = "force-dynamic";

const schema = z.object({ enabled: z.boolean() });

/**
 * Toggle "instant withdrawal" — when enabled, crypto withdrawals skip the
 * per-request 2FA (AAL2) step. Security-sensitive, so it's audited.
 */
export async function POST(req: Request) {
  try {
    const auth = await requireUser(req);
    await enforceRateLimit(`instant-wd:${auth.id}`, 5, 60_000);
    const { enabled } = schema.parse(await req.json());

    // Turning this ON removes the 2FA step from crypto withdrawals, so it must
    // itself be proven with 2FA and the transaction PIN — otherwise a stolen
    // session could switch the protection off and withdraw. Turning it off
    // only adds protection, so it needs neither.
    if (enabled) {
      requireMfa(auth);
      await requireTransactionPin(auth.id, readPin(req), { enforce: true });
    }

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
