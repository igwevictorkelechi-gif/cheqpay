import { prisma } from "@cheqpay/db";
import { requireAdminActor } from "@/lib/adminGuard";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { bannerImageUrl, deleteHomeBanner, updateHomeBanner } from "@/lib/homeBanner";
import { parseBannerInput } from "../schema";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Admin: change one banner. */
export async function PUT(req: Request, ctx: Ctx) {
  try {
    const actor = (await requireAdminActor(req)).email;
    const { id } = await ctx.params;
    const input = parseBannerInput(await req.json());
    const banner = await updateHomeBanner(id, input, actor);
    if (!banner) throw new ApiError(404, "No such banner", "not_found");
    await prisma.auditLog.create({
      data: {
        action: "admin.home_banner.updated",
        resourceType: "PlatformSetting",
        resourceId: `home_banner:${id}`,
        details: { enabled: banner.enabled, title: banner.title, image: banner.image ? "yes" : "no", actor },
      },
    });
    return jsonOk({ banner: { ...banner, imageUrl: bannerImageUrl(banner, new URL(req.url).origin) } });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** Admin: remove one banner from the carousel. */
export async function DELETE(req: Request, ctx: Ctx) {
  try {
    const actor = (await requireAdminActor(req)).email;
    const { id } = await ctx.params;
    if (!(await deleteHomeBanner(id, actor))) throw new ApiError(404, "No such banner", "not_found");
    await prisma.auditLog.create({
      data: {
        action: "admin.home_banner.deleted",
        resourceType: "PlatformSetting",
        resourceId: `home_banner:${id}`,
        details: { actor },
      },
    });
    return jsonOk({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
