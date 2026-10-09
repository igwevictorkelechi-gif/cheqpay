import { prisma } from "@cheqpay/db";
import { requireUser } from "@/lib/auth";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { enforceRateLimit } from "@/lib/ratelimit";
import { requestContext } from "@/lib/requestContext";
import { createHandoff } from "@/lib/sso";

export const dynamic = "force-dynamic";

/**
 * "Continue with CheqPay", step 2: the signed-in user confirmed on
 * mycheqpay.com/connect. Returns a one-time code (60 seconds, single use, bound
 * to the requesting tab's challenge) and the site's fixed callback URL.
 */
export async function POST(req: Request) {
  try {
    const auth = await requireUser(req);
    await enforceRateLimit(`sso-handoff:${auth.id}`, 20, 10 * 60_000);
    const body = (await req.json().catch(() => ({}))) as { client?: unknown; challenge?: unknown };
    const out = await createHandoff({ userId: auth.id, email: auth.email, client: body.client, challenge: body.challenge });
    await prisma.auditLog.create({
      data: {
        userId: auth.id,
        action: "sso.handoff",
        resourceType: "SsoClient",
        resourceId: String(body.client),
        details: { ip: requestContext(req).ip },
      },
    });
    return jsonOk({ code: out.code, return_url: out.returnUrl, expires_in: out.expiresIn });
  } catch (err) {
    return toErrorResponse(err);
  }
}
