import { prisma } from "@cheqpay/db";
import { requireUser } from "@/lib/auth";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { createVirtualAccountSchema } from "@/lib/validation";
import { createVirtualAccount, getVirtualAccount } from "@/lib/virtualAccounts";
import { assertFeatureEnabled } from "@/lib/features";

export const dynamic = "force-dynamic";

/** Fetch the user's NGN virtual account (or null if not yet created). */
export async function GET(req: Request) {
  try {
    const auth = await requireUser(req);
    return jsonOk({ virtualAccount: await getVirtualAccount(auth.id) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * Create the user's NGN virtual account. Supplying an 11-digit BVN mints a
 * permanent (dedicated) NUBAN; otherwise a temporary one. Idempotent — returns
 * the existing account if one already exists.
 */
export async function POST(req: Request) {
  try {
    const auth = await requireUser(req);
    await assertFeatureEnabled("ngn_deposits");
    const user = await prisma.user.findUnique({ where: { id: auth.id } });
    if (!user) {
      throw new ApiError(404, "Profile not provisioned; POST /api/me first", "no_profile");
    }
    const body = createVirtualAccountSchema.parse(await req.json());
    const virtualAccount = await createVirtualAccount(auth.id, user.email, body);
    return jsonOk({ virtualAccount }, 201);
  } catch (err) {
    return toErrorResponse(err);
  }
}
