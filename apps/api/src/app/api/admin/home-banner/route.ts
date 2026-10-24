import { prisma } from "@cheqpay/db";
import { requireAdmin } from "@/lib/auth";
import { requireAdminActor } from "@/lib/adminGuard";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { bannerImageUrl, createHomeBanner, listHomeBanners, MAX_BANNERS } from "@/lib/homeBanner";
import { parseBannerInput } from "./schema";

export const dynamic = "force-dynamic";

/** Admin: every home banner (live or not), in display order. */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    const origin = new URL(req.url).origin;
    const banners = (await listHomeBanners()).map((b) => ({ ...b, imageUrl: bannerImageUrl(b, origin) }));
    return jsonOk({ banners, max: MAX_BANNERS });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** Admin: add a banner at the end of the carousel. */
export async function POST(req: Request) {
  try {
    const actor = (await requireAdminActor(req)).email;
    const input = parseBannerInput(await req.json());
    const banner = await createHomeBanner(input, actor).catch((err) => {
      if (err instanceof Error && err.message === "max_banners") {
        throw new ApiError(422, `The carousel holds at most ${MAX_BANNERS} banners. Remove one first.`, "max_banners");
      }
      throw err;
    });
    await prisma.auditLog.create({
      data: {
        action: "admin.home_banner.created",
        resourceType: "PlatformSetting",
        resourceId: `home_banner:${banner.id}`,
        details: { enabled: banner.enabled, title: banner.title, image: banner.image ? "yes" : "no", actor },
      },
    });
    return jsonOk({ banner: { ...banner, imageUrl: bannerImageUrl(banner, new URL(req.url).origin) } });
  } catch (err) {
    return toErrorResponse(err);
  }
}
