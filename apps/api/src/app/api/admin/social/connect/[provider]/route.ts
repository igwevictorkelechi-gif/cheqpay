import { recordAdminAction, requireAdminActor } from "@/lib/adminGuard";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { safeReturnUrl, startConnect } from "@/lib/social/oauth";
import { isProviderId, PROVIDERS } from "@/lib/social/providers";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ provider: string }> };

/**
 * Admin (Social): begin connecting a platform. Returns the platform's login URL;
 * the dashboard sends the browser there. The dashboard proxy (server-side,
 * authenticated by the admin secret) states its own origin in x-admin-origin,
 * which is where the callback sends the admin back to.
 */
export async function POST(req: Request, ctx: Ctx) {
  try {
    const actor = await requireAdminActor(req, { section: "social" });
    const { provider } = await ctx.params;
    if (!isProviderId(provider)) throw new ApiError(404, "Unknown platform.", "not_found");
    const url = await startConnect(provider, actor.email, safeReturnUrl(req.headers.get("x-admin-origin")));
    await recordAdminAction(req, actor, {
      action: "admin.social.connect_started",
      summary: `Started connecting ${PROVIDERS[provider].label}`,
      resourceType: "SocialAccount",
    });
    return jsonOk({ url });
  } catch (err) {
    return toErrorResponse(err);
  }
}
