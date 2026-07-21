import { z } from "zod";
import { prisma } from "@cheqpay/db";
import { requireAdmin } from "@/lib/auth";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { getAppPopup, setAppPopup } from "@/lib/popup";

export const dynamic = "force-dynamic";

/** Admin: read the popup config (including when disabled). */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    return jsonOk({ popup: await getAppPopup() });
  } catch (err) {
    return toErrorResponse(err);
  }
}

const popupSchema = z.object({
  enabled: z.boolean(),
  title: z.string().trim().min(1).max(80),
  message: z.string().trim().min(1).max(500),
  imageUrl: z.string().trim().max(900_000).nullable(), // https or data: URL
  buttonText: z.string().trim().max(30).nullable(),
  buttonUrl: z.string().trim().max(300).nullable(),
});

/** Admin: replace the popup. Saving mints a new id so everyone sees it once. */
export async function PUT(req: Request) {
  try {
    await requireAdmin(req);
    const actor = req.headers.get("x-admin-actor") ?? "admin";
    const body = popupSchema.parse(await req.json());
    if (
      body.imageUrl &&
      !body.imageUrl.startsWith("https://") &&
      !body.imageUrl.startsWith("data:image/")
    ) {
      throw new ApiError(422, "Image must be an https URL or an uploaded image", "bad_image");
    }
    const popup = await setAppPopup(body, actor);
    await prisma.auditLog.create({
      data: {
        action: "admin.popup.updated",
        resourceType: "PlatformSetting",
        resourceId: "app_popup",
        details: { enabled: body.enabled, title: body.title, actor },
      },
    });
    return jsonOk({ popup });
  } catch (err) {
    return toErrorResponse(err);
  }
}
