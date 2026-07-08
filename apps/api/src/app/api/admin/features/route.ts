import { z } from "zod";
import { prisma } from "@cheqpay/db";
import { requireAdmin } from "@/lib/auth";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { FEATURE_DEFS, getFeatureFlags, setFeatureFlags } from "@/lib/features";

export const dynamic = "force-dynamic";

/** Admin: current feature switches with their labels. */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    return jsonOk({ definitions: FEATURE_DEFS, features: await getFeatureFlags() });
  } catch (err) {
    return toErrorResponse(err);
  }
}

const patchSchema = z
  .object(
    Object.fromEntries(FEATURE_DEFS.map((f) => [f.key, z.boolean().optional()]))
  )
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: "Provide at least one feature to update",
  });

/** Admin: flip feature switches. Takes effect for all clients immediately. */
export async function PUT(req: Request) {
  try {
    await requireAdmin(req);
    const actor = req.headers.get("x-admin-actor") ?? "admin";
    const patch = patchSchema.parse(await req.json());
    const features = await setFeatureFlags(patch, actor);
    await prisma.auditLog.create({
      data: {
        action: "admin.features.updated",
        resourceType: "PlatformSetting",
        resourceId: "feature_flags",
        details: { patch, actor },
      },
    });
    return jsonOk({ definitions: FEATURE_DEFS, features });
  } catch (err) {
    return toErrorResponse(err);
  }
}
