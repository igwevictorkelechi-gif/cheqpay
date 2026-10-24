import { z } from "zod";
import { prisma } from "@cheqpay/db";
import { requireAdmin } from "@/lib/auth";
import { requireAdminActor } from "@/lib/adminGuard";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { getHomeBanner, isAllowedBannerImage, setHomeBanner } from "@/lib/homeBanner";

export const dynamic = "force-dynamic";

/** Admin: read the home banner (including when switched off). */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    return jsonOk({ banner: await getHomeBanner() });
  } catch (err) {
    return toErrorResponse(err);
  }
}

const optionalText = (max: number) =>
  z.string().trim().max(max).nullable().transform((v) => (v ? v : null));

const bannerSchema = z.object({
  enabled: z.boolean(),
  imageUrl: z.string().trim().max(900_000).nullable(), // https or data: URL
  title: optionalText(40),
  message: optionalText(90),
  linkUrl: optionalText(300),
});

/** Admin: replace the home banner. */
export async function PUT(req: Request) {
  try {
    const actor = (await requireAdminActor(req)).email;
    const body = bannerSchema.parse(await req.json());
    if (body.imageUrl && !isAllowedBannerImage(body.imageUrl)) {
      throw new ApiError(422, "The image must be an uploaded PNG, JPG or WebP, or an https link", "bad_image");
    }
    if (!body.imageUrl && !body.title) {
      throw new ApiError(422, "Add a banner image or a title", "empty_banner");
    }
    if (body.linkUrl && !body.linkUrl.startsWith("/") && !body.linkUrl.startsWith("https://")) {
      throw new ApiError(422, "The link must be an in-app path like /deposit or an https link", "bad_link");
    }
    const banner = await setHomeBanner(body, actor);
    await prisma.auditLog.create({
      data: {
        action: "admin.home_banner.updated",
        resourceType: "PlatformSetting",
        resourceId: "home_banner",
        details: { enabled: body.enabled, title: body.title, hasImage: Boolean(body.imageUrl), actor },
      },
    });
    return jsonOk({ banner });
  } catch (err) {
    return toErrorResponse(err);
  }
}
