import { prisma } from "@cheqpay/db";
import { consumeState, callbackUrl } from "@/lib/social/oauth";
import { isProviderId, PROVIDERS } from "@/lib/social/providers";
import { SocialError } from "@/lib/social/providers/types";
import { saveConnectedProfiles } from "@/lib/social/store";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ provider: string }> };

function back(returnUrl: string, params: Record<string, string>): Response {
  const u = new URL(returnUrl);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v.slice(0, 300));
  return Response.redirect(u.toString(), 302);
}

function page(message: string, status = 400): Response {
  const safe = message.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CheqPay</title>` +
      `<body style="font-family:system-ui,sans-serif;max-width:520px;margin:15vh auto;padding:0 20px;color:#24105e">` +
      `<h1 style="font-size:22px">Couldn’t finish connecting</h1><p>${safe}</p>` +
      `<p>Close this tab, go back to the dashboard’s Social → Accounts page and try again.</p></body>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );
}

/**
 * Public: where a platform sends the browser after login. Only a flow started
 * from the dashboard (a live, single-use state row) can complete here.
 */
export async function GET(req: Request, ctx: Ctx) {
  const { provider } = await ctx.params;
  if (!isProviderId(provider)) return page("Unknown platform.", 404);
  const url = new URL(req.url);
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code");
  const denied = url.searchParams.get("error_description") || url.searchParams.get("error");

  if (!state) return page("The login didn’t come back with its security check.");
  const flow = await consumeState(provider, state).catch(() => null);
  if (!flow) return page("This connection link has expired or was already used.");

  if (denied) return back(flow.returnUrl, { error: `${PROVIDERS[provider].label}: ${denied}` });
  if (!code) return back(flow.returnUrl, { error: "The platform didn’t send back a login code." });

  try {
    const profiles = await PROVIDERS[provider].exchange({
      code,
      redirectUri: callbackUrl(provider),
      codeVerifier: flow.codeVerifier ?? undefined,
    });
    const n = await saveConnectedProfiles(profiles, flow.actor);
    await prisma.auditLog
      .create({
        data: {
          action: "admin.social.account_connected",
          resourceType: "SocialAccount",
          resourceId: provider,
          details: {
            actor: flow.actor,
            provider,
            accounts: profiles.map((p) => ({ platform: p.platform, name: p.name })),
          },
        },
      })
      .catch(() => undefined);
    return back(flow.returnUrl, { connected: provider, count: String(n) });
  } catch (err) {
    const message = err instanceof SocialError ? err.message : "Something went wrong saving the account.";
    if (!(err instanceof SocialError)) console.error("[social] oauth callback failed", { provider }, err);
    return back(flow.returnUrl, { error: message });
  }
}
