import { prisma, Prisma } from "@cheqpay/db";
import { requireUser } from "@/lib/auth";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { resolvePrefs } from "@/lib/notifications";
import { notificationPrefsSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

/** Current per-category notification opt-ins (defaults merged in). */
export async function GET(req: Request) {
  try {
    const auth = await requireUser(req);
    const user = await prisma.user.findUnique({
      where: { id: auth.id },
      select: { notificationPrefs: true },
    });
    if (!user) {
      throw new ApiError(404, "Profile not provisioned; POST /api/me first", "no_profile");
    }
    return jsonOk({ preferences: resolvePrefs(user.notificationPrefs) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** Update a subset of the opt-ins; unspecified categories are unchanged. */
export async function PATCH(req: Request) {
  try {
    const auth = await requireUser(req);
    const patch = notificationPrefsSchema.parse(await req.json());

    const user = await prisma.user.findUnique({
      where: { id: auth.id },
      select: { notificationPrefs: true },
    });
    if (!user) {
      throw new ApiError(404, "Profile not provisioned; POST /api/me first", "no_profile");
    }

    const merged = { ...resolvePrefs(user.notificationPrefs), ...patch };
    await prisma.user.update({
      where: { id: auth.id },
      data: { notificationPrefs: merged as Prisma.InputJsonValue },
    });

    return jsonOk({ preferences: merged });
  } catch (err) {
    return toErrorResponse(err);
  }
}
