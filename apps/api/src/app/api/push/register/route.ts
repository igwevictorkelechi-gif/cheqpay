import { prisma } from "@cheqpay/db";
import { requireUser } from "@/lib/auth";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { pushTokenSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

/** Register this device's Expo push token (idempotent — deduped per user). */
export async function POST(req: Request) {
  try {
    const auth = await requireUser(req);
    const { token } = pushTokenSchema.parse(await req.json());

    const user = await prisma.user.findUnique({
      where: { id: auth.id },
      select: { pushTokens: true },
    });
    if (!user) {
      throw new ApiError(404, "Profile not provisioned; POST /api/me first", "no_profile");
    }

    if (!user.pushTokens.includes(token)) {
      await prisma.user.update({
        where: { id: auth.id },
        data: { pushTokens: { set: [...user.pushTokens, token] } },
      });
    }
    return jsonOk({ registered: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** Remove this device's push token (e.g. on logout / opt-out). */
export async function DELETE(req: Request) {
  try {
    const auth = await requireUser(req);
    const { token } = pushTokenSchema.parse(await req.json());

    const user = await prisma.user.findUnique({
      where: { id: auth.id },
      select: { pushTokens: true },
    });
    if (!user) {
      throw new ApiError(404, "Profile not provisioned; POST /api/me first", "no_profile");
    }

    await prisma.user.update({
      where: { id: auth.id },
      data: { pushTokens: { set: user.pushTokens.filter((t) => t !== token) } },
    });
    return jsonOk({ removed: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
