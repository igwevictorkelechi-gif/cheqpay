import { requireAdminActor } from "@/lib/adminGuard";
import { getEnv } from "@/lib/env";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { callbackUrl } from "@/lib/social/oauth";
import { PROVIDERS, PROVIDER_IDS } from "@/lib/social/providers";
import { supabaseAdminConfig } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

/** Admin (Social): which platforms are ready to connect, and the callback URL each one needs. */
export async function GET(req: Request) {
  try {
    await requireAdminActor(req, { section: "social" });
    const env = getEnv();
    const providers = PROVIDER_IDS.map((id) => {
      const p = PROVIDERS[id];
      let cb: string | null = null;
      try {
        cb = callbackUrl(id);
      } catch {
        cb = null;
      }
      return { id, label: p.label, platforms: p.platforms, configured: p.configured(), callbackUrl: cb };
    });
    return jsonOk({
      providers,
      storageConfigured: Boolean(supabaseAdminConfig()),
      publicUrlConfigured: Boolean(env.API_PUBLIC_URL),
      tiktokPublic: env.TIKTOK_APP_AUDITED,
      mediaProxyBase: env.API_PUBLIC_URL ? `${env.API_PUBLIC_URL.replace(/\/+$/, "")}/api/social/media/` : null,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
